package party.froghub;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;

/**
 * Frog Hub, full screen. The page gets the microphone (only Frog Hub's own site), can play sound without a tap,
 * and never lets the tablet lock. After a few idle minutes the screen goes dark (backlight down, black cover) but the
 * app keeps running, so a tap or the wake word lights it straight back up with no lock screen.
 * Five quick taps in the top-left corner open the settings (URL, screen-off delay, open on startup, exit).
 */
public class MainActivity extends Activity {
    static final String PREFS = "froghub";
    static final String DEFAULT_URL = ""; // none: it asks on first start
    static final int MIC_REQUEST = 1;
    static final long RETRY_MS = 10_000;
    static final int DEFAULT_DIM_MINUTES = 5;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable retry = this::load;
    private final Runnable sleep = this::sleep;
    private SharedPreferences prefs;
    private WebView web;
    private View cover; // black, over the page while the screen is "off"; also swallows the tap that wakes it
    private boolean asleep;
    private boolean swallowing; // the rest of the touch that woke the screen, so it doesn't press a button
    private WifiManager.WifiLock wifiLock; // so Wi-Fi never naps while the screen is dark
    private PermissionRequest pendingMic; // a page request waiting on Android's own mic prompt
    private boolean showingError;
    private int cornerTaps;
    private IsrgTrust isrg; // null if the bundled roots wouldn't load
    private long firstCornerTap;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        takeUrlFrom(getIntent());

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifi != null) {
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "froghub");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        }
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        setVolumeControlStream(AudioManager.STREAM_MUSIC); // volume keys change Frog Hub's volume, not the ringer

        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        cover = new View(this);
        cover.setBackgroundColor(0xFF000000);
        cover.setVisibility(View.GONE);
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        root.addView(cover);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // settings and the HA token live in localStorage
        s.setMediaPlaybackRequiresUserGesture(false); // speak answers without a tap first
        s.setUserAgentString(s.getUserAgentString() + " FrogHubApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect over adb
        web.addJavascriptInterface(new PageBridge(), "FrogHubApp"); // Frog Hub calls FrogHubApp.wake() on the wake word

        try {
            isrg = new IsrgTrust(this);
        } catch (Exception e) {
            isrg = null; // then Let's Encrypt sites stay blocked on old tablets, as they would in any browser
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                // Stay on Frog Hub (links elsewhere do nothing), apart from Home Assistant's login page for
                // "Log in with Home Assistant", which sends it straight back
                return !isFrogHub(uri) && !"/auth/authorize".equals(uri.getPath());
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                showError(description); // only called for the page itself, not its images and scripts
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler ssl, SslError error) {
                // Only "untrusted root" is worth a second look (see IsrgTrust); expired, wrong host etc. stay refused.
                boolean onlyUntrusted = error.getPrimaryError() == SslError.SSL_UNTRUSTED
                        && !error.hasError(SslError.SSL_IDMISMATCH) && !error.hasError(SslError.SSL_EXPIRED)
                        && !error.hasError(SslError.SSL_NOTYETVALID);
                if (!onlyUntrusted || isrg == null) {
                    refuse(ssl, error);
                    return;
                }
                new Thread(() -> {
                    boolean ok = isrg.trusts(error.getUrl(), error.getCertificate());
                    runOnUiThread(() -> {
                        if (ok) ssl.proceed();
                        else refuse(ssl, error);
                    });
                }).start();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!showingError && isFrogHub(Uri.parse(url))) view.clearHistory(); // so Back can't land on the error page
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recreate(); // the page crashed or was killed for memory: start again rather than closing the app
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> answerPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (request == pendingMic) pendingMic = null;
            }
        });

        // Ask for the mic up front, so the first "Hey Verity" isn't swallowed by Android's prompt.
        if (Build.VERSION.SDK_INT >= 23 && !hasMic()) requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
        load();
        wake();
    }

    /** What the page can call. Only Frog Hub's own site is ever loaded (see shouldOverrideUrlLoading). */
    private class PageBridge {
        @JavascriptInterface
        public void wake() {
            runOnUiThread(MainActivity.this::wake);
        }

        /** For the "Tablet app" part of Frog Hub's settings screen. */
        @JavascriptInterface
        public String getSettings() {
            try {
                return new JSONObject()
                        .put("url", url())
                        .put("dimMinutes", dimMinutes())
                        .put("openOnStartup", prefs.getBoolean("boot", false))
                        .put("version", appVersion())
                        .toString();
            } catch (JSONException e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setSettings(String json) {
            try {
                JSONObject s = new JSONObject(json);
                String oldUrl = url();
                String newUrl = s.optString("url", oldUrl).trim();
                prefs.edit()
                        .putString("url", newUrl.isEmpty() ? DEFAULT_URL : newUrl)
                        .putInt("dim_minutes", Math.max(0, s.optInt("dimMinutes", DEFAULT_DIM_MINUTES)))
                        .putBoolean("boot", s.optBoolean("openOnStartup", false))
                        .apply();
                runOnUiThread(() -> {
                    if (!url().equals(oldUrl)) load();
                    wake(); // restart the countdown with the new delay
                });
            } catch (JSONException e) {
                // a broken settings object from the page: keep the old settings
            }
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(MainActivity.this::finish);
        }
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    private int dimMinutes() {
        return prefs.getInt("dim_minutes", DEFAULT_DIM_MINUTES);
    }

    /**
     * Screen "off": the window stays awake (no lock screen, mic still listening), but the backlight goes almost to zero.
     * Not exactly zero: Fire OS takes BRIGHTNESS_OVERRIDE_OFF as the display being off, and then the WebView and Wi-Fi
     * doze until a tap, so the wake word stops working. Behind the black cover it looks the same.
     */
    private void sleep() {
        asleep = true;
        cover.setVisibility(View.VISIBLE);
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = 0.01f;
        getWindow().setAttributes(lp);
    }

    /** Light the screen back up (if it was dark) and restart the idle countdown. */
    private void wake() {
        if (asleep) {
            asleep = false;
            cover.setVisibility(View.GONE);
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE; // back to the system brightness
            getWindow().setAttributes(lp);
        }
        handler.removeCallbacks(sleep);
        if (dimMinutes() > 0) handler.postDelayed(sleep, dimMinutes() * 60_000L);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeUrlFrom(intent)) load();
    }

    /** `adb shell am start -n party.froghub/.MainActivity -e url https://...` sets the address. */
    private boolean takeUrlFrom(Intent intent) {
        String url = intent == null ? null : intent.getStringExtra("url");
        if (TextUtils.isEmpty(url)) return false;
        prefs.edit().putString("url", url).apply();
        return true;
    }

    private String url() {
        return prefs.getString("url", DEFAULT_URL);
    }

    private boolean isFrogHub(Uri uri) {
        String host = Uri.parse(url()).getHost();
        return host != null && host.equalsIgnoreCase(uri.getHost());
    }

    private void load() {
        handler.removeCallbacks(retry);
        showingError = false;
        if (url().isEmpty()) {
            String html = "<html><body style='background:#111;color:#ffd21f;font-family:sans-serif;text-align:center;padding-top:28vh'>"
                    + "<div style='font-size:64px'>&#x1F438;</div><h2>Where's Frog Hub?</h2>"
                    + "<p style='color:#999'>Type its address, e.g. https://hub.example.com</p></body></html>";
            web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            showSettings();
            return;
        }
        web.loadUrl(url());
    }

    private void showError(String why) {
        if (showingError) return;
        showingError = true;
        String html = "<html><body style='background:#111;color:#ffd21f;font-family:sans-serif;text-align:center;padding-top:28vh'>"
                + "<div style='font-size:64px'>&#x1F438;</div><h2>Can't reach Frog Hub</h2>"
                + "<p style='color:#999'>" + TextUtils.htmlEncode(why == null ? "" : why) + "<br>Trying again in 10 seconds&hellip;</p>"
                + "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        handler.postDelayed(retry, RETRY_MS);
    }

    private void refuse(SslErrorHandler ssl, SslError error) {
        ssl.cancel();
        // A refused page gets no onReceivedError, so without this the screen would just stay black.
        if (isFrogHub(Uri.parse(error.getUrl()))) showError("Frog Hub's security certificate isn't trusted");
    }

    private void answerPermission(PermissionRequest request) {
        boolean wantsMic = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
        if (!wantsMic || !isFrogHub(request.getOrigin())) {
            request.deny(); // no camera, no other sites
            return;
        }
        if (hasMic()) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingMic = request;
            requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
        }
    }

    private boolean hasMic() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != MIC_REQUEST || pendingMic == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingMic.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingMic.deny();
        }
        pendingMic = null;
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent e) {
        int action = e.getActionMasked();
        if (asleep || swallowing) {
            if (action == MotionEvent.ACTION_DOWN) wake();
            swallowing = action != MotionEvent.ACTION_UP && action != MotionEvent.ACTION_CANCEL;
            return true;
        }
        if (action == MotionEvent.ACTION_DOWN) wake(); // any touch restarts the countdown
        float corner = 80 * getResources().getDisplayMetrics().density;
        if (action == MotionEvent.ACTION_DOWN && e.getX() < corner && e.getY() < corner) {
            long now = SystemClock.uptimeMillis();
            if (now - firstCornerTap > 3000) {
                firstCornerTap = now;
                cornerTaps = 0;
            }
            if (++cornerTaps >= 5) {
                cornerTaps = 0;
                showSettings();
            }
        }
        return super.dispatchTouchEvent(e);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getAction() == KeyEvent.ACTION_DOWN) wake(); // volume keys wake it too (and still change the volume)
        return super.dispatchKeyEvent(e);
    }

    private void showSettings() {
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad / 2, pad, 0);
        EditText address = new EditText(this);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("Frog Hub's address, e.g. https://hub.example.com");
        address.setText(url());
        box.addView(address);
        EditText dim = new EditText(this);
        dim.setInputType(InputType.TYPE_CLASS_NUMBER);
        dim.setHint("Screen off after (minutes, 0 = never)");
        dim.setText(String.valueOf(dimMinutes()));
        box.addView(dim);
        CheckBox boot = new CheckBox(this);
        boot.setText("Open on startup");
        boot.setChecked(prefs.getBoolean("boot", false));
        box.addView(boot);

        new AlertDialog.Builder(this)
                .setTitle("Frog Hub")
                .setView(box)
                .setPositiveButton("Save and reload", (d, w) -> {
                    String typed = address.getText().toString().trim();
                    prefs.edit()
                            .putString("url", typed.isEmpty() ? DEFAULT_URL : typed)
                            .putBoolean("boot", boot.isChecked())
                            .putInt("dim_minutes", parseMinutes(dim.getText().toString()))
                            .apply();
                    load();
                    wake();
                })
                .setNeutralButton("Exit app", (d, w) -> finish())
                .setNegativeButton("Cancel", null)
                .show();
    }

    private static int parseMinutes(String typed) {
        try {
            return Math.max(0, Integer.parseInt(typed.trim()));
        } catch (NumberFormatException e) {
            return DEFAULT_DIM_MINUTES;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); // never closes the app: it's a smart display
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController bars = getWindow().getInsetsController();
            if (bars == null) return;
            bars.hide(WindowInsets.Type.systemBars());
            bars.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retry);
        handler.removeCallbacks(sleep);
        if (wifiLock != null) wifiLock.release();
        web.destroy();
        super.onDestroy();
    }
}

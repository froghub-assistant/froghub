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
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Frog Hub, full screen, whatever shows the page: Android's own WebView (MainActivity) or, in the full app, GeckoView
 * (GeckoActivity in android-full/). The page gets the microphone (only Frog Hub's own site), can play sound without
 * a tap, and never lets the tablet lock. After a few idle minutes the screen goes dark (backlight down, black cover) but
 * the app keeps running, so a tap or the wake word lights it straight back up with no lock screen.
 * Five quick taps in the top-left corner open the settings (URL, screen-off delay, open on startup, exit).
 */
public abstract class DisplayActivity extends Activity {
    static final String PREFS = "froghub";
    static final String DEFAULT_URL = ""; // none: it asks on first start
    static final int MIC_REQUEST = 1;
    static final long RETRY_MS = 10_000;
    static final int DEFAULT_DIM_MINUTES = 5;

    protected final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable retry = this::load;
    private final Runnable sleep = this::sleep;
    protected SharedPreferences prefs;
    private View cover; // black, over the page while the screen is "off"; also swallows the tap that wakes it
    private boolean asleep;
    private boolean swallowing; // the rest of the touch that woke the screen, so it doesn't press a button
    private WifiManager.WifiLock wifiLock; // so Wi-Fi never naps while the screen is dark
    protected boolean showingError;
    private int cornerTaps;
    private long firstCornerTap;
    private DlnaSpeaker dlna; // the Music Assistant speaker, when the page asks for it (engines too old for Sendspin)

    /** The view that shows the page. */
    protected abstract View createPage();

    protected abstract void openUrl(String url);

    protected abstract void showHtml(String html);

    /** Calls `window.<function>(<json>)` in the page, if the page has it. */
    protected abstract void callPage(String function, String json);

    /** Back within the page, if it can; false if not. */
    protected abstract boolean pageBack();

    /** Android's answer to asking for the microphone, for a page request waiting on it. */
    protected abstract void micAnswered(boolean granted);

    protected abstract void pageResume();

    protected abstract void pagePause();

    protected abstract void pageDestroy();

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

        View page = createPage();
        cover = new View(this);
        cover.setBackgroundColor(0xFF000000);
        cover.setVisibility(View.GONE);
        FrameLayout root = new FrameLayout(this);
        root.addView(page);
        root.addView(cover);
        setContentView(root);

        // Ask for the mic up front, so the first "Hey Verity" isn't swallowed by Android's prompt.
        if (Build.VERSION.SDK_INT >= 23 && !hasMic()) requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
        load();
        wake();
    }

    // ---- What the page can ask for (passed on from the page's FrogHubApp object) ----

    /** For the "Tablet app" part of Frog Hub's settings screen. */
    protected String settingsJson() {
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

    protected void applySettings(String json) {
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

    /** A DLNA speaker called `name` for Music Assistant (see DlnaSpeaker), when Sendspin can't run here. */
    protected void startDlna(String name) {
        runOnUiThread(() -> {
            if (dlna == null) dlna = new DlnaSpeaker(this, this::dlnaChanged);
            dlna.start(name);
        });
    }

    protected void stopDlna() {
        runOnUiThread(() -> {
            if (dlna != null) dlna.stop();
        });
    }

    protected void duckDlna(boolean on) {
        if (dlna != null) dlna.duck(on);
    }

    protected void stopDlnaPlayback() {
        if (dlna != null) dlna.stopPlayback();
    }

    /** Tells the page what the DLNA speaker is playing (music.svelte.js shows it). */
    private void dlnaChanged(boolean playing, String title, String artist) {
        try {
            callPage("frogHubDlna", new JSONObject().put("playing", playing).put("title", title).put("artist", artist).toString());
        } catch (JSONException e) {
            // nothing to tell
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
     * Not exactly zero: Fire OS takes BRIGHTNESS_OVERRIDE_OFF as the display being off, and then the page and Wi-Fi
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
    protected void wake() {
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

    /**
     * `adb shell am start -n party.froghub/.MainActivity -e url https://...` sets the address
     * (the full app: `-n party.froghub.full/party.froghub.GeckoActivity`).
     */
    private boolean takeUrlFrom(Intent intent) {
        String url = intent == null ? null : intent.getStringExtra("url");
        if (TextUtils.isEmpty(url)) return false;
        prefs.edit().putString("url", url).apply();
        return true;
    }

    protected String url() {
        return prefs.getString("url", DEFAULT_URL);
    }

    protected boolean isFrogHub(Uri uri) {
        String host = Uri.parse(url()).getHost();
        return host != null && host.equalsIgnoreCase(uri.getHost());
    }

    protected void load() {
        handler.removeCallbacks(retry);
        showingError = false;
        if (url().isEmpty()) {
            showHtml("<html><body style='background:#111;color:#ffd21f;font-family:sans-serif;text-align:center;padding-top:28vh'>"
                    + "<div style='font-size:64px'>&#x1F438;</div><h2>Where's Frog Hub?</h2>"
                    + "<p style='color:#999'>Type its address, e.g. https://hub.example.com</p></body></html>");
            showSettings();
            return;
        }
        openUrl(url());
    }

    protected void showError(String why) {
        if (showingError) return;
        showingError = true;
        showHtml("<html><body style='background:#111;color:#ffd21f;font-family:sans-serif;text-align:center;padding-top:28vh'>"
                + "<div style='font-size:64px'>&#x1F438;</div><h2>Can't reach Frog Hub</h2>"
                + "<p style='color:#999'>" + TextUtils.htmlEncode(why == null ? "" : why) + "<br>Trying again in 10 seconds&hellip;</p>"
                + "</body></html>");
        handler.postDelayed(retry, RETRY_MS);
    }

    protected boolean hasMic() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    protected void askForMic() {
        requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != MIC_REQUEST) return;
        micAnswered(results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED);
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
        pageBack(); // never closes the app: it's a smart display
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
        pageResume();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        pagePause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retry);
        handler.removeCallbacks(sleep);
        if (wifiLock != null) wifiLock.release();
        if (dlna != null) dlna.stop();
        pageDestroy();
        super.onDestroy();
    }
}

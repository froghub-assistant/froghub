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
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import java.util.Arrays;
import java.util.regex.Pattern;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Frog Hub, full screen, whatever shows the page: Android's own WebView (MainActivity) or, in the full app, GeckoView
 * (GeckoActivity in android-full/). The page gets the microphone (only Frog Hub's own site), can play sound without
 * a tap, and never lets the tablet lock. After a few idle minutes the screen goes dark (backlight down, black cover) but
 * the app keeps running, so a tap or the wake word lights it straight back up with no lock screen.
 * Five quick taps in the top-left corner open the settings (URL, screen-off delay, screensaver, open on startup, exit).
 * The screensaver itself is the page's (src/lib/Screensaver.svelte): the app keeps its settings and hands them over
 * (FrogHubApp.getScreensaverSettings), and turns the backlight down while it's on (FrogHubApp.dimScreen).
 */
public abstract class DisplayActivity extends Activity {
    static final String PREFS = "froghub";
    static final String DEFAULT_URL = ""; // none: it asks on first start
    static final int MIC_REQUEST = 1;
    static final long RETRY_MS = 10_000;
    static final int DEFAULT_DIM_MINUTES = 5;
    static final int DEFAULT_SAVER_MINUTES = 5;
    static final float SAVER_BRIGHTNESS = 0.1f; // the backlight while the screensaver is on and dimmed
    // The screensaver's modes, as the page knows them, and as the settings dialog shows them
    static final String[] SAVER_MODES = {"clock", "face", "photos", "mix"};
    static final String[] SAVER_MODE_NAMES = {"A big clock", "The face, floating about", "Photos", "A mix of all three"};
    private static final Pattern TIME = Pattern.compile("([01]?\\d|2[0-3]):[0-5]\\d");

    protected final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable retry = this::load;
    private final Runnable sleep = this::sleep;
    private final Runnable hideBars = this::hideSystemBars;
    protected SharedPreferences prefs;
    private View cover; // black, over the page while the screen is "off"; also swallows the tap that wakes it
    private boolean asleep;
    private boolean saverDimmed; // the page's screensaver asked for the backlight down
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
        if (Build.VERSION.SDK_INT < 30) watchSystemBars();

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

    /** The screensaver's settings for the page (screensaver.js fromApp), with when the screen goes off (0 = never). */
    protected String screensaverJson() {
        try {
            return new JSONObject()
                    .put("enabled", prefs.getBoolean("saver_on", false))
                    .put("mode", saverMode())
                    .put("minutes", prefs.getInt("saver_minutes", DEFAULT_SAVER_MINUTES))
                    .put("activeHours", prefs.getBoolean("saver_hours", false))
                    .put("from", prefs.getString("saver_from", "07:00"))
                    .put("to", prefs.getString("saver_to", "21:00"))
                    .put("dim", prefs.getBoolean("saver_dim", true))
                    .put("screenOffMinutes", dimMinutes())
                    .toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    /** The screensaver's settings from Frog Hub's settings screen (screensaver.js toApp). */
    protected void applyScreensaver(String json) {
        try {
            JSONObject s = new JSONObject(json);
            String mode = s.optString("mode", saverMode());
            prefs.edit()
                    .putBoolean("saver_on", s.optBoolean("enabled", false))
                    .putString("saver_mode", Arrays.asList(SAVER_MODES).contains(mode) ? mode : saverMode())
                    .putInt("saver_minutes", Math.max(1, Math.min(240, s.optInt("minutes", DEFAULT_SAVER_MINUTES))))
                    .putBoolean("saver_hours", s.optBoolean("activeHours", false))
                    .putString("saver_from", time(s.optString("from"), prefs.getString("saver_from", "07:00")))
                    .putString("saver_to", time(s.optString("to"), prefs.getString("saver_to", "21:00")))
                    .putBoolean("saver_dim", s.optBoolean("dim", true))
                    .apply();
        } catch (JSONException e) {
            // a broken settings object from the page: keep the old settings
        }
    }

    /** The screensaver came on (dim the backlight, if it's set to) or went (back to normal). */
    protected void dimScreen(boolean on) {
        runOnUiThread(() -> {
            saverDimmed = on;
            applyBrightness();
        });
    }

    private String saverMode() {
        String mode = prefs.getString("saver_mode", "clock");
        return Arrays.asList(SAVER_MODES).contains(mode) ? mode : "clock";
    }

    private static String time(String typed, String fallback) {
        String t = typed == null ? "" : typed.trim();
        if (!TIME.matcher(t).matches()) return fallback;
        return t.length() == 4 ? "0" + t : t; // 7:30 -> 07:30
    }

    /**
     * The screensaver's idle minutes as the page will use them: it has to come on before the screen goes off, so a
     * minute before (half a minute, with a one-minute screen-off) when it wouldn't. The same as screensaver.js.
     */
    static String saverStartsAfter(int saverMinutes, int screenOffMinutes) {
        if (screenOffMinutes <= 0 || saverMinutes < screenOffMinutes) return saverMinutes + (saverMinutes == 1 ? " minute" : " minutes");
        return screenOffMinutes > 1 ? (screenOffMinutes - 1) + (screenOffMinutes == 2 ? " minute" : " minutes") : "half a minute";
    }

    /** Settings changed in the five-tap dialog (the full app passes them on to its page). */
    protected void settingsChanged() {
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
        applyBrightness();
    }

    /** Almost off while asleep, down while the screensaver dims it, otherwise the system's own brightness. */
    private void applyBrightness() {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = asleep ? 0.01f : saverDimmed ? SAVER_BRIGHTNESS : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        getWindow().setAttributes(lp);
    }

    /** Light the screen back up (if it was dark) and restart the idle countdown. */
    protected void wake() {
        if (asleep) {
            asleep = false;
            saverDimmed = false;
            cover.setVisibility(View.GONE);
            applyBrightness(); // back to the system brightness
            callPage("frogHubWoke", "{}"); // the page's screensaver goes with the same tap
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

        // The screensaver (drawn by the page, which reads these through FrogHubApp.getScreensaverSettings)
        TextView saverTitle = new TextView(this);
        saverTitle.setText("Screensaver");
        saverTitle.setPadding(0, pad / 2, 0, 0);
        saverTitle.setTextSize(16);
        box.addView(saverTitle);
        CheckBox saverOn = new CheckBox(this);
        saverOn.setText("Screensaver when nobody's using it");
        saverOn.setChecked(prefs.getBoolean("saver_on", false));
        box.addView(saverOn);
        Spinner saverMode = new Spinner(this);
        ArrayAdapter<String> modes = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, SAVER_MODE_NAMES);
        modes.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        saverMode.setAdapter(modes);
        saverMode.setSelection(Arrays.asList(SAVER_MODES).indexOf(saverMode()));
        box.addView(saverMode);
        EditText saverMinutes = new EditText(this);
        saverMinutes.setInputType(InputType.TYPE_CLASS_NUMBER);
        saverMinutes.setHint("Screensaver after (idle minutes)");
        saverMinutes.setText(String.valueOf(prefs.getInt("saver_minutes", DEFAULT_SAVER_MINUTES)));
        box.addView(saverMinutes);
        TextView saverNote = new TextView(this);
        box.addView(saverNote);
        CheckBox saverDim = new CheckBox(this);
        saverDim.setText("Dim the screen while it's on");
        saverDim.setChecked(prefs.getBoolean("saver_dim", true));
        box.addView(saverDim);
        CheckBox saverHours = new CheckBox(this);
        saverHours.setText("Only between these times:");
        saverHours.setChecked(prefs.getBoolean("saver_hours", false));
        box.addView(saverHours);
        LinearLayout hours = new LinearLayout(this);
        hours.setOrientation(LinearLayout.HORIZONTAL);
        EditText saverFrom = timeField(prefs.getString("saver_from", "07:00"), "from, e.g. 07:00");
        EditText saverTo = timeField(prefs.getString("saver_to", "21:00"), "to, e.g. 21:00");
        hours.addView(saverFrom, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        hours.addView(saverTo, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        box.addView(hours);

        // It has to start before the screen goes off: say when it actually will
        Runnable explain = () -> {
            int saver = parseMinutes(saverMinutes.getText().toString(), DEFAULT_SAVER_MINUTES);
            int off = parseMinutes(dim.getText().toString(), DEFAULT_DIM_MINUTES);
            saverNote.setText(off > 0 && Math.max(1, saver) >= off
                    ? "The screen goes off after " + off + (off == 1 ? " minute" : " minutes") + ", so the screensaver starts after "
                            + saverStartsAfter(Math.max(1, saver), off) + " instead."
                    : "");
            saverNote.setVisibility(saverNote.getText().length() > 0 ? View.VISIBLE : View.GONE);
        };
        TextWatcher retell = new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                explain.run();
            }
        };
        saverMinutes.addTextChangedListener(retell);
        dim.addTextChangedListener(retell);
        explain.run();

        ScrollView scroll = new ScrollView(this); // a short landscape screen can't show it all at once
        scroll.addView(box);

        new AlertDialog.Builder(this)
                .setTitle("Frog Hub")
                .setView(scroll)
                .setPositiveButton("Save and reload", (d, w) -> {
                    String typed = address.getText().toString().trim();
                    int mode = saverMode.getSelectedItemPosition();
                    prefs.edit()
                            .putString("url", typed.isEmpty() ? DEFAULT_URL : typed)
                            .putBoolean("boot", boot.isChecked())
                            .putInt("dim_minutes", parseMinutes(dim.getText().toString(), DEFAULT_DIM_MINUTES))
                            .putBoolean("saver_on", saverOn.isChecked())
                            .putString("saver_mode", SAVER_MODES[mode >= 0 && mode < SAVER_MODES.length ? mode : 0])
                            .putInt("saver_minutes", Math.max(1, Math.min(240, parseMinutes(saverMinutes.getText().toString(), DEFAULT_SAVER_MINUTES))))
                            .putBoolean("saver_dim", saverDim.isChecked())
                            .putBoolean("saver_hours", saverHours.isChecked())
                            .putString("saver_from", time(saverFrom.getText().toString(), prefs.getString("saver_from", "07:00")))
                            .putString("saver_to", time(saverTo.getText().toString(), prefs.getString("saver_to", "21:00")))
                            .apply();
                    settingsChanged();
                    load();
                    wake();
                })
                .setNeutralButton("Exit app", (d, w) -> finish())
                .setNegativeButton("Cancel", null)
                .show();
    }

    private EditText timeField(String value, String hint) {
        EditText field = new EditText(this);
        field.setInputType(InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_TIME);
        field.setHint(hint);
        field.setText(value);
        return field;
    }

    private static int parseMinutes(String typed, int fallback) {
        try {
            return Math.max(0, Integer.parseInt(typed.trim()));
        } catch (NumberFormatException e) {
            return fallback;
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

    /**
     * Before Android 11, "sticky" hiding doesn't always stick: a swipe from the edge, the keyboard or a dialog can bring
     * the navigation bar back over the page's buttons and leave it there. So whenever the bars show, hide them again
     * a couple of seconds later.
     */
    @SuppressWarnings("deprecation")
    private void watchSystemBars() {
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(flags -> {
            if ((flags & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) != 0) return;
            handler.removeCallbacks(hideBars);
            handler.postDelayed(hideBars, 2000);
        });
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
        handler.removeCallbacks(hideBars);
        if (wifiLock != null) wifiLock.release();
        if (dlna != null) dlna.stop();
        pageDestroy();
        super.onDestroy();
    }
}

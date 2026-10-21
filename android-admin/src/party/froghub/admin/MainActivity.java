package party.froghub.admin;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.SslErrorHandler;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Frog Hub Admin: <site>/admin in a WebView. It asks for the site on first start (or
 * `adb shell am start -n party.froghub.admin/.MainActivity -e url https://...`). Links elsewhere open in the browser,
 * Back goes back within the page, and when the server can't be reached (away from home, Wi-Fi off) it says so with Retry
 * and Change address buttons.
 * Runs on Android 5.1 too (e.g. old Fire tablets), with the same Let's Encrypt check as the tablet app (IsrgTrust).
 */
public class MainActivity extends Activity {
    static final int BG = Color.parseColor("#0b1d12");

    private WebView web;
    private LinearLayout offline;
    private TextView offlineText;
    private IsrgTrust isrg; // null if the bundled roots wouldn't load
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("admin", MODE_PRIVATE);
        takeUrlFrom(getIntent());
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        // Android 15 draws apps under the status and navigation bars: keep the page clear of them
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(0, top, 0, bottom);
            return insets;
        });

        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        try {
            isrg = new IsrgTrust(this);
        } catch (Exception e) {
            isrg = null;
        }
        // The old (deprecated) callbacks: the newer ones don't exist on Android 5.1
        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (uri.getHost() != null && uri.getHost().equalsIgnoreCase(Uri.parse(site()).getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                showOffline("Can't reach Frog Hub.\nIt only works on the home Wi-Fi.");
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler ssl, SslError error) {
                // Only "untrusted root" gets a second look (old Android doesn't know Let's Encrypt); nothing else
                boolean onlyUntrusted = error.getPrimaryError() == SslError.SSL_UNTRUSTED
                        && !error.hasError(SslError.SSL_IDMISMATCH) && !error.hasError(SslError.SSL_EXPIRED)
                        && !error.hasError(SslError.SSL_NOTYETVALID);
                if (!onlyUntrusted || isrg == null) {
                    refuse(ssl);
                    return;
                }
                new Thread(() -> {
                    boolean ok = isrg.trusts(error.getUrl(), error.getCertificate());
                    runOnUiThread(() -> {
                        if (ok) ssl.proceed();
                        else refuse(ssl);
                    });
                }).start();
            }
        });

        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(Gravity.CENTER);
        offline.setBackgroundColor(BG);
        offlineText = new TextView(this);
        offlineText.setTextColor(Color.parseColor("#eaffea"));
        offlineText.setTextSize(18);
        offlineText.setGravity(Gravity.CENTER);
        Button retry = new Button(this);
        retry.setText("Retry");
        retry.setOnClickListener(v -> load());
        Button change = new Button(this);
        change.setText("Change address");
        change.setOnClickListener(v -> askForSite());
        offline.addView(offlineText);
        offline.addView(retry);
        offline.addView(change);
        offline.setVisibility(View.GONE);

        root.addView(web);
        root.addView(offline);
        setContentView(root);
        if (saved != null && !site().isEmpty()) web.restoreState(saved);
        else load();
    }

    /** Frog Hub's address, e.g. "https://hub.example.com" ("" until it's been given). */
    private String site() {
        return prefs.getString("site", "");
    }

    private boolean takeUrlFrom(Intent intent) {
        String url = intent == null ? null : intent.getStringExtra("url");
        if (TextUtils.isEmpty(url)) return false;
        setSite(url);
        return true;
    }

    private void setSite(String typed) {
        String site = typed.trim().replaceAll("/+$", "").replaceAll("/admin$", "");
        if (!site.isEmpty() && !site.contains("://")) site = "https://" + site;
        prefs.edit().putString("site", site).apply();
    }

    private void load() {
        offline.setVisibility(View.GONE);
        if (site().isEmpty()) {
            showOffline("Where's Frog Hub?");
            askForSite();
        } else {
            web.loadUrl(site() + "/admin/");
        }
    }

    private void askForSite() {
        EditText address = new EditText(this);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://hub.example.com");
        address.setText(site());
        new AlertDialog.Builder(this)
                .setTitle("Frog Hub's address")
                .setView(address)
                .setPositiveButton("Open", (d, w) -> {
                    setSite(address.getText().toString());
                    load();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeUrlFrom(intent)) load();
    }

    private void showOffline(String why) {
        offlineText.setText("🐸\n\n" + why);
        offline.setVisibility(View.VISIBLE);
    }

    private void refuse(SslErrorHandler ssl) {
        ssl.cancel();
        showOffline("Frog Hub's security certificate isn't trusted.");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}

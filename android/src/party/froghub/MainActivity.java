package party.froghub;

import android.net.Uri;
import android.net.http.SslError;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.Arrays;

/** Frog Hub in Android's own WebView (see DisplayActivity for everything else). */
public class MainActivity extends DisplayActivity {
    private WebView web;
    private PermissionRequest pendingMic; // a page request waiting on Android's own mic prompt
    private IsrgTrust isrg; // null if the bundled roots wouldn't load

    @Override
    protected View createPage() {
        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);

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
        return web;
    }

    /** What the page can call. Only Frog Hub's own site is ever loaded (see shouldOverrideUrlLoading). */
    private class PageBridge {
        @JavascriptInterface
        public void wake() {
            runOnUiThread(MainActivity.this::wake);
        }

        @JavascriptInterface
        public String getSettings() {
            return settingsJson();
        }

        @JavascriptInterface
        public void setSettings(String json) {
            applySettings(json);
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(MainActivity.this::finish);
        }

        @JavascriptInterface
        public void startDlna(String name) {
            MainActivity.this.startDlna(name);
        }

        @JavascriptInterface
        public void stopDlna() {
            MainActivity.this.stopDlna();
        }

        @JavascriptInterface
        public void duckDlna(boolean on) {
            MainActivity.this.duckDlna(on);
        }

        @JavascriptInterface
        public void stopDlnaPlayback() {
            MainActivity.this.stopDlnaPlayback();
        }
    }

    @Override
    protected void openUrl(String url) {
        web.loadUrl(url);
    }

    @Override
    protected void showHtml(String html) {
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    @Override
    protected void callPage(String function, String json) {
        runOnUiThread(() -> web.evaluateJavascript("window." + function + " && window." + function + "(" + json + ")", null));
    }

    @Override
    protected boolean pageBack() {
        if (!web.canGoBack()) return false;
        web.goBack();
        return true;
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
            askForMic();
        }
    }

    @Override
    protected void micAnswered(boolean granted) {
        if (pendingMic == null) return;
        if (granted) pendingMic.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else pendingMic.deny();
        pendingMic = null;
    }

    @Override
    protected void pageResume() {
        web.onResume();
    }

    @Override
    protected void pagePause() {
        web.onPause();
    }

    @Override
    protected void pageDestroy() {
        web.destroy();
    }
}

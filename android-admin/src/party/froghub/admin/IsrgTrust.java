package party.froghub.admin;

import android.content.Context;
import android.net.Uri;
import android.net.http.SslCertificate;
import android.util.Base64;

import java.io.InputStream;
import java.net.URL;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/**
 * Fire OS 5 (Android 5.1) is older than Let's Encrypt's roots, so its WebView calls every Let's Encrypt site untrusted
 * and quietly shows nothing. This checks such a site again with ISRG Root X1 and X2 (bundled in res/raw) as the only
 * trusted roots: a fresh connection with the full chain and hostname checked, whose certificate must be the same one
 * the WebView was given. Only then does the WebView go ahead. Nothing else is relaxed.
 */
final class IsrgTrust {
    private final SSLContext tls;
    private final Set<String> verified = new HashSet<>(); // "host sha256" of certificates that already passed

    IsrgTrust(Context context) throws Exception {
        KeyStore roots = KeyStore.getInstance(KeyStore.getDefaultType());
        roots.load(null, null);
        CertificateFactory x509 = CertificateFactory.getInstance("X.509");
        int[] files = {R.raw.isrg_root_x1, R.raw.isrg_root_x2};
        for (int i = 0; i < files.length; i++) {
            try (InputStream in = context.getResources().openRawResource(files[i])) {
                roots.setCertificateEntry("isrg" + i, x509.generateCertificate(in));
            }
        }
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(roots);
        tls = SSLContext.getInstance("TLS");
        tls.init(null, tmf.getTrustManagers(), null);
    }

    /** Blocking (it connects to the site), so call it off the main thread. */
    boolean trusts(String pageUrl, SslCertificate shown) {
        byte[] leaf = der(shown);
        Uri u = Uri.parse(pageUrl); // not java.net.URL, which doesn't know wss://
        if (leaf == null || u.getHost() == null || !("https".equals(u.getScheme()) || "wss".equals(u.getScheme()))) return false;
        String key = u.getHost().toLowerCase() + " " + sha256(leaf);
        synchronized (verified) {
            if (verified.contains(key)) return true;
        }
        HttpsURLConnection c = null;
        try {
            c = (HttpsURLConnection) new URL("https", u.getHost(), u.getPort(), "/").openConnection();
            c.setSSLSocketFactory(tls.getSocketFactory()); // the default hostname check stays on
            c.setConnectTimeout(10_000);
            c.setReadTimeout(10_000);
            c.setRequestMethod("HEAD");
            c.connect();
            Certificate[] chain = c.getServerCertificates();
            if (chain.length == 0 || !Arrays.equals(chain[0].getEncoded(), leaf)) return false;
            synchronized (verified) {
                verified.add(key);
            }
            return true;
        } catch (Exception e) {
            return false; // the handshake failed: not a Let's Encrypt certificate for this host, or not reachable
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** The certificate's bytes. SslCertificate only exposes them directly from Android 10, but saveState has them. */
    private static byte[] der(SslCertificate cert) {
        return cert == null ? null : SslCertificate.saveState(cert).getByteArray("x509-certificate");
    }

    private static String sha256(byte[] data) {
        try {
            return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(data), Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}

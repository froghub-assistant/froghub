#!/bin/sh
# Builds froghub-admin.apk with the plain Android SDK tools (no Gradle): aapt2, javac, d8, zipalign, apksigner.
# Run it on an x86 computer with the Android SDK (its build tools don't run on ARM, e.g. a Raspberry Pi).
set -eu
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
TOOLS=$SDK/build-tools/36.1.0
ANDROID_JAR=$SDK/platforms/android-36/android.jar
KEYSTORE=${KEYSTORE:-$HOME/.android/debug.keystore} # updates must be signed with the same key

rm -rf build
mkdir -p build/classes build/dex
"$TOOLS/aapt2" compile --dir res -o build/res.zip
"$TOOLS/aapt2" link build/res.zip -I "$ANDROID_JAR" --manifest AndroidManifest.xml \
    --min-sdk-version 22 --target-sdk-version 36 --java build/gen -o build/app.apk
javac --release 11 -Xlint:-options -classpath "$ANDROID_JAR" -d build/classes $(find src build/gen -name '*.java')
"$TOOLS/d8" --min-api 22 --lib "$ANDROID_JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../app.apk classes.dex)
"$TOOLS/zipalign" -f -p 4 build/app.apk build/aligned.apk
# The SDK's debug key by default ("android" is its well-known password, not a secret); the release workflow gives
# its own KEYSTORE and KS_PASS.
"$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:${KS_PASS:-android}" --out froghub-admin.apk build/aligned.apk
echo "built $(pwd)/froghub-admin.apk"

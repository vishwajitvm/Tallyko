# syntax=docker/dockerfile:1
# Free, local Android build: produces a signed release APK (to share/sideload) and an AAB (for Google Play).
# Used by: docker compose --profile android run --rm android-build
FROM eclipse-temurin:17-jdk-jammy

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    EXPO_NO_TELEMETRY=1 \
    GRADLE_OPTS="-Dorg.gradle.daemon=false -Dorg.gradle.jvmargs=-Xmx4g"
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip git ca-certificates python3 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Android command-line tools + the SDK packages React Native 0.86 / Expo SDK 57 build against
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
    && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
    && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
    && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && rm /tmp/tools.zip \
    && yes | sdkmanager --licenses > /dev/null \
    && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" > /dev/null

COPY android-build.sh /usr/local/bin/android-build
RUN chmod +x /usr/local/bin/android-build

WORKDIR /workspace
CMD ["android-build"]

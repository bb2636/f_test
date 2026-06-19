import { useEffect, useRef, useState, useCallback } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ScreenCapture from "expo-screen-capture";
import * as ScreenOrientation from "expo-screen-orientation";

const APP_URL = "https://floxn-test.replit.app/";
const BRAND = "#253396";

export default function App() {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const onNav = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style="light" />
        <WebView
          ref={webRef}
          source={{ uri: APP_URL }}
          style={styles.web}
          onNavigationStateChange={onNav}
          onLoadStart={() => {
            if (!hasLoadedOnce.current) setLoading(true);
          }}
          onLoadProgress={({ nativeEvent }) => {
            if (nativeEvent.progress >= 1) setLoading(false);
          }}
          onLoadEnd={() => {
            hasLoadedOnce.current = true;
            setLoading(false);
          }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaCapturePermissionGrantType="grant"
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          startInLoadingState
        />
        {loading && (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND },
  web: { flex: 1, backgroundColor: "#fff" },
  loader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
});

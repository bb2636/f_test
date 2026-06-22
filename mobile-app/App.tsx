import { useEffect, useRef, useState, useCallback } from "react";
import {
  ActivityIndicator,
  BackHandler,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
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
  const [errored, setErrored] = useState(false);
  const hasLoadedOnce = useRef(false);
  const retryCount = useRef(0);
  const MAX_AUTO_RETRY = 3;

  // 일시적 연결 끊김(주로 오토스케일 콜드스타트/재배포 직후 ERR_CONNECTION_ABORTED)은
  // 자동으로 몇 차례 재시도하고, 그래도 실패하면 사용자에게 재시도 화면을 보여준다.
  const manualRetry = useCallback(() => {
    retryCount.current = 0;
    setErrored(false);
    setLoading(true);
    webRef.current?.reload();
  }, []);

  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    // 기본은 세로 고정. 견적서 화면에서만 가로로 전환한다(onNav 참조).
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  }, []);

  useEffect(() => {
    // 증빙자료 사진 업로드 시 WebView 파일 input(카메라 촬영)에 필요한 런타임 권한.
    if (Platform.OS !== "android") return;
    PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    ).catch(() => {});
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
    // 견적서(작성) 화면은 가로(landscape) 고정, 그 외에는 세로(portrait) 고정.
    const isEstimate = (nav.url || "").includes("/field-survey/estimate");
    ScreenOrientation.lockAsync(
      isEstimate
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style="light" />
        <WebView
          ref={webRef}
          source={{ uri: APP_URL }}
          applicationNameForUserAgent="FloxnMobileApp"
          style={styles.web}
          onNavigationStateChange={onNav}
          onLoadStart={() => {
            if (!hasLoadedOnce.current) setLoading(true);
          }}
          onLoadProgress={({ nativeEvent }) => {
            if (nativeEvent.progress >= 1) setLoading(false);
          }}
          onLoad={() => {
            // 로드 성공 시 자동 재시도 카운터를 리셋한다.
            retryCount.current = 0;
            setErrored(false);
          }}
          onLoadEnd={() => {
            hasLoadedOnce.current = true;
            setLoading(false);
          }}
          onError={() => {
            // react-native-webview의 onError는 메인 프레임 로드 실패에만 발생한다.
            if (retryCount.current < MAX_AUTO_RETRY) {
              retryCount.current += 1;
              setLoading(true);
              setTimeout(() => webRef.current?.reload(), 1500);
              return;
            }
            setLoading(false);
            setErrored(true);
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
        {loading && !errored && (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        )}
        {errored && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>연결에 실패했어요</Text>
            <Text style={styles.errorDesc}>
              네트워크 상태를 확인한 뒤 다시 시도해 주세요.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={manualRetry}>
              <Text style={styles.retryText}>다시 시도</Text>
            </TouchableOpacity>
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
  errorBox: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  errorDesc: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  retryBtn: {
    backgroundColor: BRAND,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});

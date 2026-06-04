import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export default function PdfViewer() {
  const { buildingId } = useLocalSearchParams<{ buildingId: string }>();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/buildings/${buildingId}/permit`);
        if (!res.ok) {
          setError('Could not load permit');
          return;
        }
        const json = await res.json();
        const decoded = base64ToUtf8(json.fileBase64);
        setHtml(decoded);
      } catch (e: any) {
        setError(e?.message || 'Network error');
      } finally {
        setLoading(false);
      }
    })();
  }, [buildingId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2c5f2e" />
      </View>
    );
  }

  if (error || !html) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Unknown error'}</Text>
      </View>
    );
  }

  return (
    <WebView
      style={styles.webview}
      originWhitelist={['*']}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      source={{ html }}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: '#e8e8e8',
  },
  center: {
    flex: 1,
    backgroundColor: '#e8e8e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#c0392b',
    fontSize: 15,
    textAlign: 'center',
    padding: 24,
  },
});

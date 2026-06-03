import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Linking } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export default function PdfViewer() {
  const { buildingId, name } = useLocalSearchParams<{ buildingId: string; name?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAndShare = async () => {
      try {
        const path = `${FileSystem.cacheDirectory}permit_${buildingId}.pdf`;
        const result = await FileSystem.downloadAsync(
          `${API_URL}/buildings/${buildingId}/permit`,
          path,
        );
        if (result.status !== 200) {
          setError('Failed to download document');
          return;
        }
        await Sharing.shareAsync(path, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: 'View Permit',
        });
        router.back();
      } catch (e: any) {
        setError(e?.message || 'Could not open document');
      }
    };

    fetchAndShare();
  }, [buildingId]);

  return (
    <View style={{ flex: 1, backgroundColor: '#181818', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      {error ? (
        <Text style={{ color: '#E24B4A', fontSize: 15, textAlign: 'center', padding: 24 }}>{error}</Text>
      ) : (
        <ActivityIndicator size="large" color="#378ADD" />
      )}
    </View>
  );
}

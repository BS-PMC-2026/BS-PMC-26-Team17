import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
const RESEND_COOLDOWN = 30; // seconds — matches backend RESEND_COOLDOWN_SECONDS

type Step = 1 | 2 | 3;

export default function ForgotPasswordScreen() {
  // Wizard state
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    timerRef.current = setInterval(() => {
      setResendIn((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resendIn]);

  // ── Step 1: request code ──────────────────────────────────────────────────
  const sendCode = async () => {
    setError('');
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Failed to send code.');
        return;
      }
      setStep(2);
      setResendIn(RESEND_COOLDOWN);
    } catch {
      setError('Cannot connect to server.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify code ──────────────────────────────────────────────────
  const verifyCode = async () => {
    setError('');
    if (code.trim().length !== 6) {
      setError('Please enter the 6-digit code.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-reset-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Invalid code.');
        return;
      }
      setStep(3);
    } catch {
      setError('Cannot connect to server.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: submit new password ──────────────────────────────────────────
  const submitNewPassword = async () => {
    setError('');
    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          new_password: newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Failed to reset password.');
        return;
      }
      Alert.alert('Success', 'Your password has been reset. Please log in.', [
        { text: 'OK', onPress: () => router.replace('/login') },
      ]);
    } catch {
      setError('Cannot connect to server.');
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    if (resendIn > 0) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Could not resend code.');
        return;
      }
      setResendIn(RESEND_COOLDOWN);
    } catch {
      setError('Cannot connect to server.');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (step === 1) {
      router.back();
      return;
    }
    setError('');
    setStep((s) => (s - 1) as Step);
  };

  // Header text changes with the step
  const stepCopy = {
    1: { title: 'Reset password', subtitle: 'Enter the email tied to your account.' },
    2: { title: 'Check your inbox', subtitle: `We sent a 6-digit code to ${email}.` },
    3: { title: 'Pick a new password', subtitle: 'Use something you’ll remember.' },
  }[step];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo header — same family as login */}
        <View style={styles.logoWrapper}>
          <View style={styles.logoCircle}>
            <Ionicons name="lock-closed" size={48} color="#fff" />
          </View>
          <Text style={styles.brand}>ToSafePlace</Text>
          <Text style={styles.tagline}>Your safety, our priority</Text>
        </View>

        <View style={styles.card}>
          <TouchableOpacity onPress={goBack} style={styles.backRow} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={18} color="#0a7ea4" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>{stepCopy.title}</Text>
          <Text style={styles.subtitle}>{stepCopy.subtitle}</Text>

          {/* Step indicator */}
          <View style={styles.dots}>
            {[1, 2, 3].map((n) => (
              <View
                key={n}
                style={[styles.dot, n <= step && styles.dotActive]}
              />
            ))}
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#e74c3c" />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          {step === 1 && (
            <>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color="#94a3b8"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor="#94a3b8"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <PrimaryButton
                label="Send Code"
                onPress={sendCode}
                loading={loading}
                icon="arrow-forward"
              />
            </>
          )}

          {step === 2 && (
            <>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="keypad-outline"
                  size={20}
                  color="#94a3b8"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  placeholder="● ● ● ● ● ●"
                  placeholderTextColor="#cbd5e1"
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>
              <PrimaryButton
                label="Verify Code"
                onPress={verifyCode}
                loading={loading}
                icon="checkmark"
              />

              <TouchableOpacity
                onPress={resendCode}
                disabled={resendIn > 0 || loading}
                style={styles.resendButton}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.resendText,
                    resendIn > 0 && styles.resendTextDisabled,
                  ]}
                >
                  {resendIn > 0
                    ? `Resend code in ${resendIn}s`
                    : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 3 && (
            <>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color="#94a3b8"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor="#94a3b8"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.inputWrapper}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color="#94a3b8"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm new password"
                  placeholderTextColor="#94a3b8"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirm}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirm((v) => !v)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
              </View>

              <PrimaryButton
                label="Reset Password"
                onPress={submitNewPassword}
                loading={loading}
                icon="checkmark-circle"
              />
            </>
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.replace('/login' as never)}
          >
            <Text style={styles.linkText}>
              Remember it after all? <Text style={styles.linkTextBold}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Small button helper so the three steps don't repeat the same JSX block
function PrimaryButton({
  label,
  onPress,
  loading,
  icon,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <TouchableOpacity
      style={[styles.button, loading && styles.buttonDisabled]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <Text style={styles.buttonText}>{label}</Text>
          <Ionicons name={icon} size={18} color="#fff" />
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a7ea4',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoWrapper: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    marginBottom: 12,
  },
  brand: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 6,
    paddingVertical: 4,
  },
  backText: {
    color: '#0a7ea4',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 18,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
  },
  dotActive: { backgroundColor: '#0a7ea4' },

  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    marginBottom: 14,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 15,
    color: '#0f172a',
  },
  codeInput: {
    textAlign: 'center',
    fontSize: 20,
    letterSpacing: 8,
    fontWeight: '700',
  },
  eyeBtn: { padding: 4 },

  button: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#0a7ea4',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#0a7ea4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  resendButton: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  resendText: { color: '#0a7ea4', fontSize: 14, fontWeight: '600' },
  resendTextDisabled: { color: '#94a3b8', fontWeight: '500' },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 6,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    marginHorizontal: 12,
    color: '#94a3b8',
    fontSize: 12,
  },
  linkButton: { marginTop: 8, alignItems: 'center', paddingVertical: 6 },
  linkText: { color: '#64748b', fontSize: 14 },
  linkTextBold: { color: '#0a7ea4', fontWeight: '700' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  error: { color: '#e74c3c', fontSize: 13, flex: 1 },
});

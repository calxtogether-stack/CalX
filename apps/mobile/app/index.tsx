import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import {
  allClear,
  applyPercentage,
  clearEntry,
  createInitialCalculatorState,
  deleteLast,
  evaluateEquals,
  extractPureDigitSequence,
  inputDecimal,
  inputDigit,
  inputOperator,
  toggleSign,
  type CalculatorState,
  type Conversation,
  type Message,
  type Profile,
} from '@calx/shared';
import { palette } from '@calx/design-system';
import {
  canEditMessage,
  formatCountdown,
  getRemainingSeconds,
  MessagingService,
  parseRichContent,
  searchLocalDecryptedMessages,
  type LocalDeviceCredentials,
} from '@calx/messaging';
import { loginSchema, pinSetupSchema, registerSchema } from '@calx/validation';
import * as Notifications from 'expo-notifications';
import { getMobileSupabaseClient } from '@/lib/supabase';
import {
  authenticateWithBiometrics,
  hasMobilePin,
  loadMobileDeviceCredentials,
  saveMobileDeviceCredentials,
  setupMobilePin,
  verifyMobilePin,
} from '@/lib/vault-storage';

export default function MobileVaultScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = palette[scheme];

  const [calc, setCalc] = useState<CalculatorState>(() => createInitialCalculatorState());
  const [hasPin, setHasPin] = useState(false);
  const [modalMode, setModalMode] = useState<'setup' | 'auth' | null>(null);
  const [setupStep, setSetupStep] = useState<'pin' | 'account'>('pin');

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [session, setSession] = useState<{
    userId: string;
    credentials: LocalDeviceCredentials;
  } | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [inChatQuery, setInChatQuery] = useState('');
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);

  const supabase = useMemo(() => getMobileSupabaseClient(), []);
  const service = useMemo(() => (supabase ? new MessagingService(supabase) : null), [supabase]);

  useEffect(() => {
    void hasMobilePin().then(setHasPin);
  }, []);

  // Auto-lock immediately when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        setSession(null);
        setSelectedConv(null);
      }
    });
    return () => sub.remove();
  }, []);

  const handleEquals = useCallback(async () => {
    const digits = extractPureDigitSequence(calc);
    if (digits && hasPin) {
      const check = await verifyMobilePin(digits);
      if (check.ok) {
        setCalc(createInitialCalculatorState());
        const bio = await authenticateWithBiometrics();
        if (bio.available && !bio.authenticated) {
          Alert.alert('Verification Failed', 'Biometric verification is required.');
          return;
        }
        const creds = await loadMobileDeviceCredentials();
        if (supabase && creds) {
          const { data } = await supabase.auth.getSession();
          if (data.session?.user) {
            setSession({ userId: data.session.user.id, credentials: creds });
            // Register push token silently if permitted
            try {
              const perm = await Notifications.requestPermissionsAsync();
              if (perm.status === 'granted' && service) {
                const tok = await Notifications.getExpoPushTokenAsync();
                await service.registerPushToken(
                  data.session.user.id,
                  creds.deviceId,
                  'android',
                  tok.data,
                );
              }
            } catch {
              // Ignore push token registration errors when running in local dev
            }
            return;
          }
        }
        setSetupStep('account');
        setModalMode('auth');
        return;
      }
      if (check.lockoutSeconds > 0) {
        Alert.alert('Locked', `Too many failed attempts. Wait ${check.lockoutSeconds}s.`);
        return;
      }
    }
    setCalc((prev) => evaluateEquals(prev));
  }, [calc, hasPin, supabase, service]);

  const handlePinSetup = async () => {
    const parsed = pinSetupSchema.safeParse({ pin, confirmPin });
    if (!parsed.success) {
      Alert.alert('Invalid PIN', parsed.error.errors[0]?.message ?? 'Check your PIN');
      return;
    }
    await setupMobilePin(parsed.data.pin);
    setHasPin(true);
    setPin('');
    setConfirmPin('');
    setSetupStep('account');
  };

  const handleAccountAuth = async () => {
    if (!supabase || !service) {
      Alert.alert(
        'Not Configured',
        'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.',
      );
      return;
    }
    try {
      let userId = '';
      if (authTab === 'register') {
        const parsed = registerSchema.safeParse({ email, password, username, displayName });
        if (!parsed.success) {
          Alert.alert('Validation Error', parsed.error.errors[0]?.message ?? 'Invalid fields');
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        if (!data.user) throw new Error('Confirm your email before signing in.');
        userId = data.user.id;
        await supabase.from('profiles').upsert({
          id: userId,
          username: parsed.data.username,
          display_name: parsed.data.displayName,
        });
        await supabase.from('user_settings').upsert({ user_id: userId });
      } else {
        const parsed = loginSchema.safeParse({ email, password });
        if (!parsed.success) {
          Alert.alert('Validation Error', parsed.error.errors[0]?.message ?? 'Invalid fields');
          return;
        }
        const { data, error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        userId = data.user.id;
      }

      const { device, bundle } = await service.registerDevice(userId, 'Android Device', 'android');
      const creds: LocalDeviceCredentials = {
        deviceId: device.id,
        identityPrivateKey: bundle.identityPrivateKey,
        signingPrivateKey: bundle.signingPrivateKey,
      };
      await saveMobileDeviceCredentials(creds);
      setModalMode(null);
      setSession({ userId, credentials: creds });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Error';
      Alert.alert('Authentication Failed', msg);
    }
  };

  useEffect(() => {
    if (!session || !service) return;
    void service.listConversations().then(setConversations);
    void service.deliverDueScheduledMessages(session.userId);
  }, [session, service]);

  useEffect(() => {
    if (!session || !service || !selectedConv) return;
    let active = true;
    void service.fetchMessagesPaginated(selectedConv.id, 40).then(async (raw) => {
      const dec = await service.decryptMessages(raw, session.credentials);
      if (active) setMessages(dec);
    });
    const ch = service.subscribeToConversation(selectedConv.id, {
      onMessage: async (msg) => {
        const [dec] = await service.decryptMessages([msg], session.credentials);
        if (dec) setMessages((prev) => [...prev, dec]);
      },
    });
    return () => {
      active = false;
      ch.unsubscribe();
    };
  }, [session, service, selectedConv]);

  const sendMessage = async () => {
    if (!session || !service || !selectedConv || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    if (editingMsg) {
      const updated = await service.editEncryptedMessage({
        message: editingMsg,
        senderId: session.userId,
        credentials: session.credentials,
        newPlaintext: text,
      });
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditingMsg(null);
      return;
    }
    const sent = await service.sendEncryptedMessage({
      conversationId: selectedConv.id,
      senderId: session.userId,
      credentials: session.credentials,
      plaintext: text,
      replyToId: replyTo?.id ?? null,
    });
    setReplyTo(null);
    setMessages((prev) => [...prev, sent]);
  };

  // =========================================================================
  // AUTHENTICATED MESSENGER VIEW
  // =========================================================================
  if (session && service) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          {selectedConv ? (
            <Pressable onPress={() => setSelectedConv(null)}>
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>← Back</Text>
            </Pressable>
          ) : (
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>CalX Vault</Text>
          )}
          <Pressable
            onPress={() => {
              setSession(null);
              setSelectedConv(null);
            }}
            style={[styles.lockBtn, { borderColor: colors.borderSubtle }]}
          >
            <Text style={{ color: colors.textPrimary, fontSize: 12, fontWeight: '600' }}>Lock</Text>
          </Pressable>
        </View>

        {!selectedConv ? (
          <View style={styles.flex1}>
            <View style={{ padding: 12 }}>
              <TextInput
                value={searchQuery}
                onChangeText={async (q) => {
                  setSearchQuery(q);
                  const res = await service.searchUsersByUsername(q);
                  setSearchResults(res.filter((u) => u.id !== session.userId));
                }}
                placeholder="Search @username..."
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              />
              {searchResults.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={async () => {
                    const conv = await service.getOrCreateDirectConversation(session.userId, u.id);
                    setConversations((prev) =>
                      prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
                    );
                    setSelectedConv(conv);
                    setSearchResults([]);
                    setSearchQuery('');
                  }}
                  style={[styles.listItem, { borderBottomColor: colors.borderSubtle }]}
                >
                  <Text style={{ color: colors.textPrimary, fontWeight: '500' }}>
                    {u.display_name} (@{u.username})
                  </Text>
                </Pressable>
              ))}
            </View>
            <FlatList
              data={conversations}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedConv(item)}
                  style={[styles.listItem, { borderBottomColor: colors.borderSubtle }]}
                >
                  <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                    {item.title ?? (item.type === 'direct' ? 'Private Chat' : 'Group')}
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 12 }}>E2EE</Text>
                </Pressable>
              )}
            />
          </View>
        ) : (
          <View style={styles.flex1}>
            <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
              <TextInput
                value={inChatQuery}
                onChangeText={setInChatQuery}
                placeholder="Search local decrypted messages..."
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    borderColor: colors.borderSubtle,
                    paddingVertical: 6,
                    fontSize: 12,
                  },
                ]}
              />
            </View>
            <FlatList
              data={
                inChatQuery.trim()
                  ? searchLocalDecryptedMessages(messages, inChatQuery)
                  : messages
              }
              keyExtractor={(m) => m.client_message_id}
              contentContainerStyle={{ padding: 14, gap: 8 }}
              renderItem={({ item }) => {
                const mine = item.sender_id === session.userId;
                const rich = parseRichContent(item);
                const rem = getRemainingSeconds(item.expires_at);
                const displayBody = rich
                  ? rich.kind === 'location'
                    ? `Location: ${rich.lat.toFixed(4)}, ${rich.lng.toFixed(4)}`
                    : rich.kind === 'contact_card'
                      ? `Contact: ${rich.name}`
                      : rich.kind === 'event'
                        ? `Event: ${rich.title}`
                        : `Checklist: ${rich.title}`
                  : item.decrypted_text ?? item.decryption_error ?? 'Encrypted';

                return (
                  <Pressable
                    onLongPress={() => {
                      const actions: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }> = [
                        { text: 'Reply', onPress: () => setReplyTo(item) },
                        {
                          text: 'Star',
                          onPress: () => void service.starMessage(session.userId, item.id, selectedConv.id),
                        },
                        {
                          text: 'Pin',
                          onPress: () => void service.pinMessage(selectedConv.id, item.id, session.userId),
                        },
                      ];
                      if (canEditMessage(item, session.userId)) {
                        actions.push({
                          text: 'Edit',
                          onPress: () => {
                            setEditingMsg(item);
                            setDraft(item.decrypted_text ?? '');
                          },
                        });
                      }
                      if (mine) {
                        actions.push({
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => void service.softDeleteMessage(item.id),
                        });
                      }
                      actions.push({ text: 'Cancel', style: 'cancel' });
                      Alert.alert('Message Actions', undefined, actions);
                    }}
                    style={[
                      styles.bubble,
                      {
                        alignSelf: mine ? 'flex-end' : 'flex-start',
                        backgroundColor: mine ? colors.bubbleOutgoing : colors.bubbleIncoming,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: mine ? colors.bubbleOutgoingText : colors.bubbleIncomingText,
                      }}
                    >
                      {displayBody}
                    </Text>
                    {(item.edited_at || rem !== null) && (
                      <Text
                        style={{
                          fontSize: 10,
                          opacity: 0.65,
                          marginTop: 2,
                          color: mine ? colors.bubbleOutgoingText : colors.bubbleIncomingText,
                        }}
                      >
                        {item.edited_at ? 'Edited ' : ''}
                        {rem !== null ? formatCountdown(rem) : ''}
                      </Text>
                    )}
                  </Pressable>
                );
              }}
            />
            {(replyTo || editingMsg) && (
              <View style={{ paddingHorizontal: 14, paddingVertical: 6, flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                  {editingMsg ? 'Editing message' : `Replying to: ${replyTo?.decrypted_text ?? ''}`}
                </Text>
                <Pressable onPress={() => { setReplyTo(null); setEditingMsg(null); setDraft(''); }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Cancel</Text>
                </Pressable>
              </View>
            )}
            <View style={[styles.composer, { borderTopColor: colors.borderSubtle }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Encrypted message..."
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  styles.flex1,
                  {
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              />
              <Pressable
                onPress={() => void sendMessage()}
                style={[styles.sendBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={{ color: colors.accentForeground, fontWeight: '600' }}>Send</Text>
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // =========================================================================
  // DEFAULT SCREEN: MINIMALIST CALCULATOR
  // =========================================================================
  const isClearEntry =
    calc.currentInput !== '' && calc.currentInput !== '0' && !calc.evaluated;

  const rows: Array<Array<{ label: string; type?: 'op' | 'util' | 'eq'; onPress: () => void }>> = [
    [
      {
        label: isClearEntry ? 'C' : 'AC',
        type: 'util',
        onPress: () => setCalc((p) => (isClearEntry ? clearEntry(p) : allClear())),
      },
      { label: '+/-', type: 'util', onPress: () => setCalc((p) => toggleSign(p)) },
      { label: '%', type: 'util', onPress: () => setCalc((p) => applyPercentage(p)) },
      { label: '÷', type: 'op', onPress: () => setCalc((p) => inputOperator(p, '÷')) },
    ],
    [
      { label: '7', onPress: () => setCalc((p) => inputDigit(p, '7')) },
      { label: '8', onPress: () => setCalc((p) => inputDigit(p, '8')) },
      { label: '9', onPress: () => setCalc((p) => inputDigit(p, '9')) },
      { label: '×', type: 'op', onPress: () => setCalc((p) => inputOperator(p, '×')) },
    ],
    [
      { label: '4', onPress: () => setCalc((p) => inputDigit(p, '4')) },
      { label: '5', onPress: () => setCalc((p) => inputDigit(p, '5')) },
      { label: '6', onPress: () => setCalc((p) => inputDigit(p, '6')) },
      { label: '-', type: 'op', onPress: () => setCalc((p) => inputOperator(p, '-')) },
    ],
    [
      { label: '1', onPress: () => setCalc((p) => inputDigit(p, '1')) },
      { label: '2', onPress: () => setCalc((p) => inputDigit(p, '2')) },
      { label: '3', onPress: () => setCalc((p) => inputDigit(p, '3')) },
      { label: '+', type: 'op', onPress: () => setCalc((p) => inputOperator(p, '+')) },
    ],
    [
      { label: '0', onPress: () => setCalc((p) => inputDigit(p, '0')) },
      { label: '.', onPress: () => setCalc((p) => inputDecimal(p)) },
      { label: 'DEL', onPress: () => setCalc((p) => deleteLast(p)) },
      { label: '=', type: 'eq', onPress: () => void handleEquals() },
    ],
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.calcWrap}>
        <View
          style={[
            styles.displayBox,
            { backgroundColor: colors.bgSecondary, borderColor: colors.borderSubtle },
          ]}
        >
          <Text style={[styles.exprText, { color: colors.textTertiary }]} numberOfLines={1}>
            {calc.expression}
          </Text>
          <Text style={[styles.displayText, { color: colors.textPrimary }]} numberOfLines={1}>
            {calc.display}
          </Text>
        </View>

        <View style={styles.keypad}>
          {rows.map((row, rIdx) => (
            <View key={rIdx} style={styles.keyRow}>
              {row.map((btn) => {
                const bg =
                  btn.type === 'eq'
                    ? colors.calcKeyEqualsBg
                    : btn.type === 'op' || btn.type === 'util'
                      ? colors.calcKeyOperatorBg
                      : colors.calcKeyBg;
                const fg = btn.type === 'eq' ? colors.calcKeyEqualsText : colors.textPrimary;
                return (
                  <Pressable
                    key={btn.label}
                    onPress={btn.onPress}
                    onLongPress={() => {
                      if (!hasPin && btn.label === '=') {
                        setSetupStep('pin');
                        setModalMode('setup');
                      }
                    }}
                    style={[
                      styles.keyBtn,
                      { backgroundColor: bg, borderColor: colors.borderSubtle },
                    ]}
                  >
                    <Text style={[styles.keyLabel, { color: fg }]}>{btn.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {!hasPin && (
          <Pressable
            onPress={() => {
              setSetupStep('pin');
              setModalMode('setup');
            }}
            style={{ marginTop: 14, alignItems: 'center' }}
          >
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
              Hold = or tap to initialize vault
            </Text>
          </Pressable>
        )}
      </View>

      <Modal visible={modalMode !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.bgElevated, borderColor: colors.borderSubtle },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
              {setupStep === 'pin' ? 'Configure Vault PIN' : 'Sign In to CalX'}
            </Text>

            {setupStep === 'pin' ? (
              <View style={{ gap: 10 }}>
                <TextInput
                  value={pin}
                  onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
                  placeholder="Secret PIN (4-8 digits)"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.bgSecondary,
                      color: colors.textPrimary,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                />
                <TextInput
                  value={confirmPin}
                  onChangeText={(t) => setConfirmPin(t.replace(/\D/g, ''))}
                  placeholder="Confirm PIN"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.bgSecondary,
                      color: colors.textPrimary,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => void handlePinSetup()}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={{ color: colors.accentForeground, fontWeight: '600' }}>Save PIN</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => setAuthTab('login')}>
                    <Text
                      style={{
                        color: authTab === 'login' ? colors.textPrimary : colors.textTertiary,
                        fontWeight: '600',
                      }}
                    >
                      Sign In
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setAuthTab('register')}>
                    <Text
                      style={{
                        color: authTab === 'register' ? colors.textPrimary : colors.textTertiary,
                        fontWeight: '600',
                      }}
                    >
                      Register
                    </Text>
                  </Pressable>
                </View>

                {authTab === 'register' && (
                  <>
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      placeholder="Username"
                      placeholderTextColor={colors.textTertiary}
                      autoCapitalize="none"
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.bgSecondary,
                          color: colors.textPrimary,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    />
                    <TextInput
                      value={displayName}
                      onChangeText={setDisplayName}
                      placeholder="Display Name"
                      placeholderTextColor={colors.textTertiary}
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.bgSecondary,
                          color: colors.textPrimary,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    />
                  </>
                )}

                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.bgSecondary,
                      color: colors.textPrimary,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password (min 10 chars)"
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.bgSecondary,
                      color: colors.textPrimary,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => void handleAccountAuth()}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={{ color: colors.accentForeground, fontWeight: '600' }}>
                    {authTab === 'register' ? 'Create Account' : 'Sign In'}
                  </Text>
                </Pressable>
              </View>
            )}

            <Pressable onPress={() => setModalMode(null)} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  calcWrap: { flex: 1, justifyContent: 'flex-end', padding: 18 },
  displayBox: {
    minHeight: 136,
    justifyContent: 'flex-end',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 18,
  },
  exprText: { fontSize: 16, textAlign: 'right', marginBottom: 4 },
  displayText: { fontSize: 48, fontWeight: '500', textAlign: 'right' },
  keypad: { gap: 10 },
  keyRow: { flexDirection: 'row', gap: 10 },
  keyBtn: {
    flex: 1,
    height: 68,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: { fontSize: 20, fontWeight: '500' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  lockBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  composer: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  sendBtn: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { borderRadius: 18, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '600', marginBottom: 14 },
  primaryBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
});

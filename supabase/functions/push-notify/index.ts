// Supabase Edge Function: push-notify
// Sends generic privacy-preserving push notifications (NO plaintext message content!)
// Deploy with: supabase functions deploy push-notify

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

interface WebhookPayload {
  record: {
    id: string;
    conversation_id: string;
    sender_id: string;
  };
}

Deno.serve(async (req: Request) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    const { conversation_id, sender_id } = payload.record;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversation_id)
      .neq('user_id', sender_id);

    const recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token, platform')
      .in('user_id', recipientIds);

    const expoTokens = (tokens ?? [])
      .filter((t: { platform: string; token: string }) => t.token.startsWith('ExponentPushToken'))
      .map((t: { token: string }) => ({
        to: t.token,
        sound: 'default',
        // Generic privacy-preserving preview: never expose plaintext or sender details
        title: 'CalX',
        body: 'New activity available',
        data: { conversationId: conversation_id },
      }));

    if (expoTokens.length > 0) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expoTokens),
      });
    }

    return new Response(JSON.stringify({ sent: expoTokens.length }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

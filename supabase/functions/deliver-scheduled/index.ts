// Supabase Edge Function: deliver-scheduled
// Delivers due E2EE scheduled_messages into public.messages without ever decrypting them.
// Uses idempotency_key (client_message_id) to guarantee zero duplicate deliveries.
// Schedule with pg_cron or any free external cron hitting this endpoint every minute.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const nowIso = new Date().toISOString();
    const { data: due, error } = await supabase
      .from('scheduled_messages')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso)
      .limit(50);

    if (error) throw error;

    let delivered = 0;
    let failed = 0;

    for (const row of due ?? []) {
      const expiresAt = row.expires_after_seconds
        ? new Date(Date.now() + row.expires_after_seconds * 1000).toISOString()
        : null;

      const { data: msg, error: insErr } = await supabase
        .from('messages')
        .upsert(
          {
            conversation_id: row.conversation_id,
            sender_id: row.sender_id,
            sender_device_id: row.sender_device_id,
            client_message_id: row.idempotency_key,
            message_type: row.message_type,
            encrypted_payload: row.encrypted_payload,
            reply_to_id: row.reply_to_id,
            expires_at: expiresAt,
          },
          { onConflict: 'conversation_id,client_message_id' },
        )
        .select('id')
        .single();

      if (insErr || !msg) {
        failed += 1;
        await supabase
          .from('scheduled_messages')
          .update({
            status: 'failed',
            error_reason: insErr?.message ?? 'Insert failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      } else {
        delivered += 1;
        await supabase
          .from('scheduled_messages')
          .update({
            status: 'sent',
            sent_message_id: msg.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
    }

    return new Response(JSON.stringify({ delivered, failed }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WhatsAppMessage {
  from: string;
  id: string;
  text?: {
    body: string;
  };
  type: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method === 'GET') {
      // Webhook verification
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === Deno.env.get('WHATSAPP_VERIFY_TOKEN')) {
        console.log('Webhook verified');
        return new Response(challenge, { status: 200 });
      } else {
        return new Response('Forbidden', { status: 403 });
      }
    }

    if (req.method === 'POST') {
      const body = await req.json();
      console.log('Received webhook:', JSON.stringify(body, null, 2));

      // Process incoming WhatsApp messages
      if (body.entry && body.entry[0] && body.entry[0].changes) {
        for (const change of body.entry[0].changes) {
          if (change.value && change.value.messages) {
            for (const message of change.value.messages) {
              await processWhatsAppMessage(supabase, message);
            }
          }
        }
      }

      return new Response('OK', { status: 200 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    console.error('Error in whatsapp-webhook:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processWhatsAppMessage(supabase: any, message: WhatsAppMessage) {
  try {
    console.log('Processing message:', message);

    // Find or create chat session
    let { data: session, error: sessionError } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('whatsapp_phone', message.from)
      .eq('status', 'open')
      .single();

    if (sessionError && sessionError.code !== 'PGRST116') {
      throw sessionError;
    }

    if (!session) {
      // Create new session - assuming first user for now
      const { data: users } = await supabase
        .from('profiles')
        .select('id')
        .limit(1);

      if (!users || users.length === 0) {
        throw new Error('No users found');
      }

      const { data: newSession, error: createError } = await supabase
        .from('chat_sessions')
        .insert({
          user_id: users[0].id,
          whatsapp_phone: message.from,
          customer_name: `Customer ${message.from.slice(-4)}`,
          platform: 'whatsapp',
          status: 'open'
        })
        .select()
        .single();

      if (createError) throw createError;
      session = newSession;
    }

    // Save incoming message
    if (message.text && message.text.body) {
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          session_id: session.id,
          sender_type: 'customer',
          message_text: message.text.body,
          whatsapp_message_id: message.id
        });

      if (messageError) throw messageError;

      // Update session last message time
      await supabase
        .from('chat_sessions')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', session.id);

      // If AI is active, generate response
      if (session.is_ai_active) {
        await generateAIResponse(supabase, session, message.text.body);
      }
    }
  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
  }
}

async function generateAIResponse(supabase: any, session: any, customerMessage: string) {
  try {
    // Simple AI response logic - in production, integrate with OpenAI or similar
    let response = "Terima kasih telah menghubungi kami. Saya sedang memproses permintaan Anda.";

    // Check knowledge base for relevant responses
    const { data: knowledgeBase } = await supabase
      .from('ai_knowledge_base')
      .select('*')
      .eq('is_active', true);

    if (knowledgeBase) {
      const lowerMessage = customerMessage.toLowerCase();
      const relevantKnowledge = knowledgeBase.find((kb: any) => 
        lowerMessage.includes(kb.question.toLowerCase()) ||
        kb.question.toLowerCase().includes(lowerMessage)
      );

      if (relevantKnowledge) {
        response = relevantKnowledge.answer;
      }
    }

    // Save AI response
    await supabase
      .from('messages')
      .insert({
        session_id: session.id,
        sender_type: 'ai',
        message_text: response
      });

    // Send response via WhatsApp API
    await sendWhatsAppMessage(session.whatsapp_phone, response);
  } catch (error) {
    console.error('Error generating AI response:', error);
  }
}

async function sendWhatsAppMessage(to: string, message: string) {
  try {
    const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

    if (!accessToken || !phoneNumberId) {
      console.log('WhatsApp credentials not configured');
      return;
    }

    const response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        text: { body: message }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to send WhatsApp message:', error);
    } else {
      console.log('WhatsApp message sent successfully');
    }
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
  }
}
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, message, userId } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get session and user context
    const { data: session } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();

    if (!session) {
      throw new Error('Session not found');
    }

    // Get knowledge base for context
    const { data: knowledgeBase } = await supabase
      .from('ai_knowledge_base')
      .select('*')
      .eq('created_by', userId)
      .eq('is_active', true);

    // Get recent conversation history
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Build context for AI
    let context = "Anda adalah asisten AI yang membantu customer service. Berikut adalah knowledge base:\n\n";
    
    if (knowledgeBase && knowledgeBase.length > 0) {
      knowledgeBase.forEach((kb: any) => {
        context += `Q: ${kb.question}\nA: ${kb.answer}\n\n`;
      });
    }

    context += "\nPercakapan sebelumnya:\n";
    if (recentMessages && recentMessages.length > 0) {
      recentMessages.reverse().forEach((msg: any) => {
        const role = msg.sender_type === 'customer' ? 'Customer' : 'AI';
        context += `${role}: ${msg.message_text}\n`;
      });
    }

    // Generate AI response using OpenAI
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    let aiResponse = "Maaf, saya sedang mengalami gangguan. Tim customer service kami akan segera membantu Anda.";

    if (openAIApiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: context + "\n\nBerikan respons yang ramah, profesional, dan membantu dalam bahasa Indonesia. Jika tidak yakin dengan jawaban, katakan bahwa Anda akan menghubungkan dengan human agent."
              },
              {
                role: 'user',
                content: message
              }
            ],
            max_tokens: 500,
            temperature: 0.7,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          aiResponse = data.choices[0].message.content;
        }
      } catch (error) {
        console.error('OpenAI API error:', error);
      }
    }

    // Save AI response to database
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        sender_type: 'ai',
        message_text: aiResponse
      });

    if (messageError) throw messageError;

    // Update session timestamp
    await supabase
      .from('chat_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', sessionId);

    return new Response(JSON.stringify({ response: aiResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-chat function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
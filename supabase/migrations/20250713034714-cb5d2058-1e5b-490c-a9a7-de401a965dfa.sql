-- Create tables for WhatsApp CS integration and chat management

-- Create chat sessions table
CREATE TABLE public.chat_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  whatsapp_phone TEXT NOT NULL,
  customer_name TEXT,
  platform TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_ai_active BOOLEAN DEFAULT true,
  assigned_agent_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'ai', 'human')),
  message_text TEXT NOT NULL,
  whatsapp_message_id TEXT,
  is_read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create AI knowledge base table
CREATE TABLE public.ai_knowledge_base (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create AI training data table
CREATE TABLE public.ai_training_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  confidence_score DECIMAL(3,2) DEFAULT 0.0,
  is_verified BOOLEAN DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create WhatsApp integration settings table
CREATE TABLE public.whatsapp_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  webhook_url TEXT,
  verify_token TEXT,
  access_token TEXT,
  phone_number_id TEXT,
  business_account_id TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_training_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for chat_sessions
CREATE POLICY "Users can view their own chat sessions" 
ON public.chat_sessions 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can create their own chat sessions" 
ON public.chat_sessions 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own chat sessions" 
ON public.chat_sessions 
FOR UPDATE 
USING (user_id = auth.uid());

-- Create RLS policies for messages
CREATE POLICY "Users can view messages from their chat sessions" 
ON public.messages 
FOR SELECT 
USING (session_id IN (SELECT id FROM public.chat_sessions WHERE user_id = auth.uid()));

CREATE POLICY "Users can create messages in their chat sessions" 
ON public.messages 
FOR INSERT 
WITH CHECK (session_id IN (SELECT id FROM public.chat_sessions WHERE user_id = auth.uid()));

CREATE POLICY "Users can update messages in their chat sessions" 
ON public.messages 
FOR UPDATE 
USING (session_id IN (SELECT id FROM public.chat_sessions WHERE user_id = auth.uid()));

-- Create RLS policies for ai_knowledge_base
CREATE POLICY "Users can view their own knowledge base" 
ON public.ai_knowledge_base 
FOR SELECT 
USING (created_by = auth.uid());

CREATE POLICY "Users can create their own knowledge base" 
ON public.ai_knowledge_base 
FOR INSERT 
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update their own knowledge base" 
ON public.ai_knowledge_base 
FOR UPDATE 
USING (created_by = auth.uid());

CREATE POLICY "Users can delete their own knowledge base" 
ON public.ai_knowledge_base 
FOR DELETE 
USING (created_by = auth.uid());

-- Create RLS policies for ai_training_data
CREATE POLICY "Users can view their own training data" 
ON public.ai_training_data 
FOR SELECT 
USING (created_by = auth.uid());

CREATE POLICY "Users can create their own training data" 
ON public.ai_training_data 
FOR INSERT 
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update their own training data" 
ON public.ai_training_data 
FOR UPDATE 
USING (created_by = auth.uid());

CREATE POLICY "Users can delete their own training data" 
ON public.ai_training_data 
FOR DELETE 
USING (created_by = auth.uid());

-- Create RLS policies for whatsapp_settings
CREATE POLICY "Users can view their own WhatsApp settings" 
ON public.whatsapp_settings 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can create their own WhatsApp settings" 
ON public.whatsapp_settings 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own WhatsApp settings" 
ON public.whatsapp_settings 
FOR UPDATE 
USING (user_id = auth.uid());

-- Create indexes for better performance
CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_status ON public.chat_sessions(status);
CREATE INDEX idx_chat_sessions_last_message_at ON public.chat_sessions(last_message_at DESC);
CREATE INDEX idx_messages_session_id ON public.messages(session_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX idx_ai_knowledge_base_category ON public.ai_knowledge_base(category);
CREATE INDEX idx_ai_training_data_category ON public.ai_training_data(category);

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_chat_sessions_updated_at
BEFORE UPDATE ON public.chat_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_knowledge_base_updated_at
BEFORE UPDATE ON public.ai_knowledge_base
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_training_data_updated_at
BEFORE UPDATE ON public.ai_training_data
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_whatsapp_settings_updated_at
BEFORE UPDATE ON public.whatsapp_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
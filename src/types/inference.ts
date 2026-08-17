// src/types/inference.ts

import { z } from "zod";
import { ModelUsageMetadata } from "../lib/schemas.js";
import { 
  CreateCompanyObjectSchema, 
  CreateContactObjectSchema, 
  CreateInvoiceObjectSchema,
  CreateOfferObjectSchema,
  SendEmailObjectSchema,
  DeleteEntityObjectSchema
} from "../server/ai/tools/types.js";

export interface UniversalGenerateParams {
  provider_type: 'gemini' | 'ollama' | 'openai' | 'anthropic';
  model_name: string;
  api_key_secret?: string | null;
  base_url?: string | null;
  temperature?: number;
  contents: unknown;
  systemInstruction?: string;
  responseSchema?: unknown;
  jsonFormat?: boolean;
  tools?: unknown[];
  enableCache?: boolean;
}

export interface UniversalGenerateResult {
  text: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  usage?: ModelUsageMetadata;
  usageMetadata?: ModelUsageMetadata;
  finishReason?: string;
  rawResponse?: unknown;
}

export interface CouncilMember {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  weight: number;
  isActive: boolean;
}

export interface CouncilSettings {
  enabled: boolean;
  defaultMode: 'multi-role' | 'multi-model';
  defaultMaxRounds: number;
  members: CouncilMember[];
  peerReviewPrompt: string;
  chairmanPrompt: string;
  fallbackProviderId?: string;
  fallbackModelId?: string;
}

export type InferenzProviderType = "OLLAMA" | "VLLM" | "OPENAI_COMPATIBLE" | "LM_STUDIO";

export interface ToolCallFunction {
  name: string;
  arguments: string | Record<string, unknown>;
}

export interface ToolCall {
  id?: string;
  type?: 'function' | string;
  function?: ToolCallFunction;
  function_call?: {
    name: string;
    args: Record<string, unknown>;
  };
}

export interface InferenceMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | string;
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface InferenceResultPayload {
  text?: string;
  reasoning_content?: string;
  content?: string;
  tool_calls?: ToolCall[];
  finish_reason?: string;
  usage?: ModelUsageMetadata;
  usageMetadata?: ModelUsageMetadata;
  rawResponse?: unknown;
}

export type CouncilProviderType = 'gemini' | 'ollama' | 'openai' | 'anthropic';

export interface ParsedProposalArgs {
  proposalId?: string;
  title?: string;
  description?: string;
  category?: string;
  parameters?: Record<string, unknown>;
}

export interface IModelEndpointConfig {
  id: string;
  provider_type: InferenzProviderType;
  base_url: string;
  api_key_secret?: string;
  default_model_identifier: string; // e.g. "deepseek-coder-7b", "gemma3-9b", "qwen3.6-14b"
  supports_native_json_schema: boolean;
}

export interface IStepInferenceParameters {
  model_override?: string; // Allows executing a specific step with a different model
  temperature: number;
  max_tokens: number;
}

export const ProposedChangesZodSchema = z.object({
  entity_type: z.enum([
    "companies",
    "contacts",
    "invoices",
    "emails",
    "offers",
    "kanban_board",
    "kanban_column",
    "kanban_card"
  ]),
  action: z.enum(["CREATE", "UPDATE", "DELETE", "SEND", "MOVE"]),
  id_uuid: z.string().optional().nullable(),
  proposed_state: z.union([
    CreateCompanyObjectSchema.partial(),
    CreateContactObjectSchema.partial(),
    CreateInvoiceObjectSchema.partial(),
    CreateOfferObjectSchema.partial(),
    SendEmailObjectSchema.partial(),
    DeleteEntityObjectSchema.partial(),
    z.record(z.string(), z.unknown())
  ]).nullable(),
  explanation_rational: z.string(),
});

export const ParallelToolCallZodSchema = z.object({
  toolName: z.string(),
  toolQuery: z.string(),
});

export const ReActDecisionZodSchema = z.object({
  thought: z.string(),
  isComplete: z.boolean(),
  callToolName: z.string().nullable(),
  callToolQuery: z.string().nullable(),
  parallelToolCalls: z.array(ParallelToolCallZodSchema).optional().nullable(),
  finalDraftText: z.string().nullable(),
  proposedChanges: ProposedChangesZodSchema.nullable(),
});

export type ReActDecision = z.infer<typeof ReActDecisionZodSchema>;



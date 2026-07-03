export type GitLabAccountPayload = {
  url?: string;
  accessToken?: string;
  webhookSecret?: string | null;
  isActive?: boolean;
};

export type AIModelPayload = {
  provider?: string;
  modelId?: string;
  apiKey?: string;
  apiBaseUrl?: string | null;
  maxSteps?: number;
  isDefault?: boolean;
  isActive?: boolean;
};

export type NotificationPayload = {
  dingtalkEnabled?: boolean;
  dingtalkWebhookUrl?: string | null;
  dingtalkSecret?: string;
};

export type ToolSkillSettingsPayload = {
  tools?: Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>;
  skills?: Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>;
};

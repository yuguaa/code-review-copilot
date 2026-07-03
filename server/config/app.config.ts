export type AppConfig = {
  isDevelopment: boolean;
  isProduction: boolean;
  logLevel: string;
  port: number;
};

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const appConfig: AppConfig = {
  isDevelopment: nodeEnv === 'development',
  isProduction: nodeEnv === 'production',
  logLevel: process.env.LOG_LEVEL || (nodeEnv === 'development' ? 'debug' : 'info'),
  port: Number(process.env.PORT ?? 8787),
};

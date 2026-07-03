import { Button, Card, Checkbox, Field, Input } from '../ui';

type NotificationForm = {
  dingtalkEnabled: boolean;
  dingtalkWebhookUrl: string;
  dingtalkSecret: string;
};

export function NotificationSettingsCard({
  notification,
  saving,
  onChange,
  onSave,
}: {
  notification: NotificationForm;
  saving: boolean;
  onChange: (updater: (current: NotificationForm) => NotificationForm) => void;
  onSave: () => void;
}) {
  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg text-[var(--ink)]">全局钉钉配置</h2>
      <Checkbox
        label="开启全局钉钉推送"
        checked={notification.dingtalkEnabled}
        onChange={(value) => onChange((current) => ({ ...current, dingtalkEnabled: value }))}
      />
      <Field label="钉钉机器人 Webhook">
        <Input
          value={notification.dingtalkWebhookUrl}
          onChange={(event) => onChange((current) => ({ ...current, dingtalkWebhookUrl: event.target.value }))}
          placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
        />
      </Field>
      <Field label="钉钉加签密钥" hint="留空不会覆盖已有密钥">
        <Input
          type="password"
          value={notification.dingtalkSecret}
          onChange={(event) => onChange((current) => ({ ...current, dingtalkSecret: event.target.value }))}
          placeholder="SEC..."
        />
      </Field>
      <Button onClick={onSave} disabled={saving}>
        {saving ? '保存中…' : '保存钉钉配置'}
      </Button>
    </Card>
  );
}

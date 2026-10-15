import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Checkbox, Field, Input } from '../ui/forms';

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
    <Card className="gap-4 px-5 py-4">
      <div>
        <h2 className="text-base font-medium">全局钉钉配置</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          代码审查通知与 RSS 订阅推送共用这个机器人，两者使用不同的消息模板。
        </p>
      </div>
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
      <div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? '保存中…' : '保存钉钉配置'}
        </Button>
      </div>
    </Card>
  );
}

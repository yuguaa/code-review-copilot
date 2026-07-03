import { ToolSkillSettingsCard } from '../components/settings/ToolSkillSettingsCard';
import { GitLabAccountForm, GitLabAccountList } from '../components/settings/GitLabAccountSettings';
import { ModelList, ModelSettingsForm } from '../components/settings/ModelSettings';
import { NotificationSettingsCard } from '../components/settings/NotificationSettingsCard';
import { SettingsStatsGrid } from '../components/settings/SettingsStatsGrid';
import { PageShell } from '../components/ui/page-shell';
import { useConfirm } from '../components/ui/confirm-dialog';
import { useSettingsPageData, type Account, type AIModel } from '../hooks/useSettingsPageData';

export function Settings() {
  const {
    accounts,
    models,
    stats,
    tools,
    skills,
    enabledTools,
    enabledSkills,
    notification,
    url,
    accessToken,
    webhookSecret,
    modelForm,
    saving,
    savingModel,
    savingNotification,
    savingToolSkills,
    setEnabledTools,
    setEnabledSkills,
    setNotification,
    setUrl,
    setAccessToken,
    setWebhookSecret,
    setModel,
    add,
    test,
    remove,
    addModel,
    setDefaultModel,
    removeModel,
    saveNotification,
    saveToolSkills,
  } = useSettingsPageData();
  const { confirm, element: confirmElement } = useConfirm();

  const confirmRemoveAccount = (account: Account) => {
    void confirm({
      title: '删除 GitLab 账号',
      description: `「${account.url}」的凭证将被删除，关联仓库的 Webhook 验签与 API 调用会随之失效。`,
    }).then((ok) => {
      if (!ok) return;
      void remove(account);
    });
  };

  const confirmRemoveModel = (model: AIModel) => {
    void confirm({
      title: '删除全局模型',
      description: `「${model.provider}/${model.modelId}」将被删除，使用它的仓库会回退到默认模型。`,
    }).then((ok) => {
      if (!ok) return;
      void removeModel(model);
    });
  };

  return (
    <PageShell title="设置">
      <SettingsStatsGrid stats={stats} />
      <ToolSkillSettingsCard
        tools={tools}
        skills={skills}
        enabledTools={enabledTools}
        enabledSkills={enabledSkills}
        saving={savingToolSkills}
        onToolsChange={setEnabledTools}
        onSkillsChange={setEnabledSkills}
        onSave={saveToolSkills}
      />
      <NotificationSettingsCard
        notification={notification}
        saving={savingNotification}
        onChange={setNotification}
        onSave={saveNotification}
      />
      <ModelSettingsForm modelForm={modelForm} saving={savingModel} onModelChange={setModel} onAdd={addModel} />
      <ModelList models={models} onSetDefault={setDefaultModel} onRemove={confirmRemoveModel} />
      <GitLabAccountForm
        url={url}
        accessToken={accessToken}
        webhookSecret={webhookSecret}
        saving={saving}
        onUrlChange={setUrl}
        onAccessTokenChange={setAccessToken}
        onWebhookSecretChange={setWebhookSecret}
        onAdd={add}
      />
      <GitLabAccountList accounts={accounts} onTest={test} onRemove={confirmRemoveAccount} />
      {confirmElement}
    </PageShell>
  );
}

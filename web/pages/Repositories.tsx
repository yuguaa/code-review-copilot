import { PageShell } from '../components/ui/page-shell';
import { useConfirm } from '../components/ui/confirm-dialog';
import { RepositoryList } from '../components/repositories/RepositoryList';
import { RepositoryModal } from '../components/repositories/RepositoryModal';
import { WebhookIntro } from '../components/repositories/WebhookIntro';
import { useRepositoriesPageData, type Repo } from '../hooks/useRepositoriesPageData';

export function Repositories() {
  const page = useRepositoriesPageData();
  const { confirm, element: confirmElement } = useConfirm();
  const webhookUrl = `${location.origin}/api/webhook/gitlab`;

  const confirmRemove = (repo: Repo) => {
    void confirm({
      title: '删除仓库',
      description: `「${repo.path}」的配置与关联会话记录将被删除，Webhook 触发也会失效。`,
    }).then((ok) => {
      if (!ok) return;
      void page.remove(repo);
    });
  };

  return (
    <PageShell title="仓库配置" maxWidth="max-w-6xl">
      <WebhookIntro webhookUrl={webhookUrl} onAdd={page.openAdd} />
      <RepositoryModal
        accounts={page.accounts}
        editingId={page.editingId}
        form={page.form}
        modalOpen={page.modalOpen}
        models={page.models}
        projects={page.projects}
        saving={page.saving}
        search={page.search}
        skills={page.skills}
        tools={page.tools}
        closeModal={page.closeModal}
        fetchProjects={page.fetchProjects}
        pickProject={page.pickProject}
        setField={page.setField}
        setSearch={page.setSearch}
        submit={page.submit}
      />
      <RepositoryList repos={page.repos} onEdit={page.edit} onRemove={confirmRemove} />
      {confirmElement}
    </PageShell>
  );
}

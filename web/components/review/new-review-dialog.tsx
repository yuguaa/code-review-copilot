import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";

import { ResourceState } from "@web/components/common/resource-state";
import { Button } from "@web/components/ui/button";
import { Field, FieldGroup, Input, Select } from "@web/components/ui/forms";
import { Modal } from "@web/components/ui/modal";
import { useAction } from "@web/hooks/use-resource";
import { api } from "@web/lib/api";

import type { RepositoryItem } from "@web/lib/types";

export function NewReviewDialog({ repositories, close }: { repositories: RepositoryItem[]; close: () => void }) {
  const [form, setForm] = useState(() => ({ repositoryId: "", kind: "commit", sha: "", mrIid: "", requestId: uuid() }));
  const action = useAction();
  const navigate = useNavigate();
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value, requestId: uuid() }));
  const submit = () => action.execute("create", () => api<{ runId: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ repositoryId: form.repositoryId, kind: form.kind, requestId: form.requestId,
      ...(form.kind === "merge_request" ? { mrIid: Number(form.mrIid) } : form.sha.trim() ? { sha: form.sha.trim() } : {}),
    }),
  }).then(({ runId }) => { close(); navigate(`/runs/${runId}`); }));

  return <Modal open title="新建代码审查" onClose={() => !action.pending && close()} maxWidth="sm:max-w-lg">
    <p className="text-sm leading-6 text-muted-foreground">审查完成后按仓库配置发布 GitLab 评论和钉钉通知。</p>
    <ResourceState empty={repositories.length === 0} title="需要先添加仓库" />
    {repositories.length > 0 && <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <FieldGroup>
        <Field label="审查仓库"><Select required value={form.repositoryId} onChange={(event) => update("repositoryId", event.target.value)}>
          <option value="">请选择仓库</option>{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.path}</option>)}
        </Select></Field>
        <Field label="审查类型"><Select value={form.kind} onChange={(event) => update("kind", event.target.value)}>
          <option value="commit">单个提交</option><option value="merge_request">Merge Request</option>
        </Select></Field>
        {form.kind === "merge_request" ? <Field label="MR 编号"><Input type="number" min={1} required value={form.mrIid} onChange={(event) => update("mrIid", event.target.value)} /></Field>
          : <Field label="Commit SHA" hint="填写 40 位 SHA；留空时审查默认分支的最新提交。">
            <Input pattern="[a-fA-F0-9]{40}" maxLength={40} value={form.sha} onChange={(event) => update("sha", event.target.value)} />
          </Field>}
      </FieldGroup>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={Boolean(action.pending)} onClick={close}>取消</Button>
        <Button type="submit" disabled={Boolean(action.pending)}>{action.pending ? "正在创建…" : "开始审查"}</Button>
      </div>
    </form>}
  </Modal>;
}

import { PrismaClient } from "@prisma/client";

import { createGitLabService } from "../server/shared/gitlab/gitlab.service.ts";

const prisma = new PrismaClient();

prisma.repository.findMany({
  where: { isActive: true, enableMrComment: true, enableDingtalk: true, dingtalkRobotId: { not: null } },
  include: { gitLabAccount: true },
}).then((repositories) => repositories.reduce((pending, repository) => pending.then((targets) => {
  const gitlab = createGitLabService(repository.gitLabAccount.url, repository.gitLabAccount.accessToken);
  return gitlab.getProject(repository.gitLabProjectId).then((project) => {
    if (!project.default_branch) return targets;
    return gitlab.getBranch(project.id, project.default_branch).then((branch) => gitlab.getCommit(project.id, branch.commit.id))
      .then((commit) => {
        if (!commit.parent_ids[0]) return targets;
        return gitlab.compare(project.id, commit.parent_ids[0], commit.id).then((comparison) => targets.concat({
          repositoryId: repository.id, projectId: project.id, path: repository.path, branch: project.default_branch,
          baseSha: commit.parent_ids[0], headSha: commit.id, author: commit.author_name, filesChanged: comparison.diffs.length,
        }));
      });
  });
}), Promise.resolve([]))).then((targets) => {
  targets.sort((left, right) => left.filesChanged - right.filesChanged);
  console.info(JSON.stringify(targets.slice(0, 5)));
}).finally(() => prisma.$disconnect());

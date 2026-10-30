import { Hono } from "hono";

import { checkDingtalkConnection, listDingtalkContacts, saveDingtalkContact, searchDingtalkPeople, updateDingtalkContact } from '@server/modules/notifications/dingtalk-directory.service';
import { cancelGlobalDingtalkLogin, getGlobalDingtalkState, startGlobalDingtalkLogin, updateGlobalDingtalk } from '@server/modules/notifications/dingtalk-global.service';

import { createAIModel, deleteAIModel, getAIModel, listAIModels, testAIModel, updateAIModel } from "./ai-model-settings.service";
import { configurationError } from "./config-input";
import { createGitLabAccount, deleteGitLabAccount, listGitLabAccounts, listGitLabProjects, testGitLabAccount, updateGitLabAccount } from "./gitlab-account-settings.service";
import { createDingtalkRobot, deleteDingtalkRobot, listDingtalkRobots, updateDingtalkRobot } from "./dingtalk-robot-settings.service";
import { loadSettingsStats } from "./settings-overview.service";

export const settingsRoutes = new Hono();

settingsRoutes.onError(configurationError);
settingsRoutes.get("/gitlab", (c) => listGitLabAccounts().then((accounts) => c.json({ accounts })));
settingsRoutes.post("/gitlab", (c) => c.req.json().then(createGitLabAccount).then((account) => c.json({ account })));
settingsRoutes.patch("/gitlab/:id", (c) => c.req.json().then((body) => updateGitLabAccount(c.req.param("id"), body))
  .then((account) => c.json({ account })));
settingsRoutes.delete("/gitlab/:id", (c) => deleteGitLabAccount(c.req.param("id")).then((result) => c.json(result)));
settingsRoutes.post("/gitlab/:id/test", (c) => testGitLabAccount(c.req.param("id")).then((ok) => ok === null
  ? c.json({ error: "账号不存在" }, 404)
  : c.json({ ok })));
settingsRoutes.get("/gitlab/:id/projects", (c) => listGitLabProjects(c.req.param("id"), c.req.query("search"))
  .then((projects) => projects ? c.json({ projects }) : c.json({ error: "账号不存在" }, 404)));

settingsRoutes.get("/models", (c) => listAIModels().then((models) => c.json({ models })));
settingsRoutes.get("/models/:id", (c) => getAIModel(c.req.param("id")).then((model) => model
  ? c.json({ model })
  : c.json({ error: "模型不存在" }, 404)));
settingsRoutes.post("/models", (c) => c.req.json().then(createAIModel).then((model) => c.json({ model })));
settingsRoutes.patch("/models/:id", (c) => c.req.json().then((body) => updateAIModel(c.req.param("id"), body))
  .then((model) => c.json({ model })));
settingsRoutes.delete("/models/:id", (c) => deleteAIModel(c.req.param("id")).then((result) => c.json(result)));
settingsRoutes.post("/models/:id/test", (c) => testAIModel(c.req.param("id")).then((ok) => ok === null
  ? c.json({ error: "模型不存在" }, 404)
  : c.json({ ok })));

settingsRoutes.get("/dingtalk", (c) => listDingtalkRobots().then((robots) => c.json({ robots })));
settingsRoutes.get('/dingtalk/cli', (c) => getGlobalDingtalkState().then((state) => c.json(state)));
settingsRoutes.post('/dingtalk/cli/login', (c) => startGlobalDingtalkLogin().then((state) => c.json(state)));
settingsRoutes.post('/dingtalk/cli/cancel', (c) => c.req.json().then(cancelGlobalDingtalkLogin).then((state) => c.json(state)));
settingsRoutes.patch('/dingtalk/cli', (c) => c.req.json().then(updateGlobalDingtalk).then((state) => c.json(state)));
settingsRoutes.post("/dingtalk", (c) => c.req.json().then(createDingtalkRobot).then((robot) => c.json({ robot }, 201)));
settingsRoutes.patch("/dingtalk/:id", (c) => c.req.json().then((body) => updateDingtalkRobot(c.req.param("id"), body))
  .then((robot) => c.json({ robot })));
settingsRoutes.delete("/dingtalk/:id", (c) => deleteDingtalkRobot(c.req.param("id")).then((result) => c.json(result)));
settingsRoutes.post('/dingtalk/:id/status', (c) => checkDingtalkConnection(c.req.param('id')).then((status) => c.json({ status })));
settingsRoutes.post('/dingtalk/:id/people/search', (c) => c.req.json().then((body) => searchDingtalkPeople(c.req.param('id'), body)).then((result) => c.json(result)));
settingsRoutes.get('/dingtalk/:id/contacts', (c) => listDingtalkContacts(c.req.param('id')).then((contacts) => c.json({ contacts })));
settingsRoutes.post('/dingtalk/:id/contacts', (c) => c.req.json().then((body) => saveDingtalkContact(c.req.param('id'), body)).then((contact) => c.json({ contact })));
settingsRoutes.patch('/dingtalk/:connectionId/contacts/:id', (c) => c.req.json().then((body) => updateDingtalkContact(c.req.param('connectionId'), c.req.param('id'), body)).then((contact) => c.json({ contact })));
settingsRoutes.get("/stats", (c) => loadSettingsStats().then((stats) => c.json({ stats })));

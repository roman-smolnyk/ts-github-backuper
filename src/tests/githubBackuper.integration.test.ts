import { beforeAll, describe, expect, test } from "vitest";
import { GithubBackuper } from "../githubBackuper";

describe("GithubBackuper Integration Test (Live API Lifecycle)", () => {
  let backuper: GithubBackuper;
  let repoName: string;

  const testFilePath = `integration-test-${Date.now()}.txt`;
  const initialText = "Hello, this is an automated integration test step 1.";
  const updatedText = "Hello, this is an automated force-update test step 2!";

  beforeAll(async () => {
    const token = import.meta.env.VITE_GITHUB_TOKEN;

    if (!token) {
      throw new Error("Missing VITE_GITHUB_TOKEN in your environment variables. skipping test.");
    }

    backuper = new GithubBackuper(token);

    const repo = (await backuper.listRepos())[0];

    if (!repo) {
      throw new Error("Missing repo.");
    }

    repoName = repo.name;
  });

  test("should successfully complete a full CRUD file lifecycle on GitHub", async () => {
    const isTokenValid = await backuper.isTokenValid();
    expect(isTokenValid).toBe(true);

    const createSuccess = await backuper.putFileContentTextForce(repoName, testFilePath, initialText);
    expect(createSuccess).toBe(true);

    const fetchedText = await backuper.getFileContentText(repoName, testFilePath);
    expect(fetchedText).toBe(initialText);

    const updateSuccess = await backuper.putFileContentTextForce(repoName, testFilePath, updatedText);
    expect(updateSuccess).toBe(true);

    const fetchedUpdatedText = await backuper.getFileContentText(repoName, testFilePath);
    expect(fetchedUpdatedText).toBe(updatedText);

    const deleteSuccess = await backuper.deleteFile(repoName, testFilePath);
    expect(deleteSuccess).toBe(true);

    const postDeleteText = await backuper.getFileContentText(repoName, testFilePath);
    expect(postDeleteText).toBe("");
  });
});

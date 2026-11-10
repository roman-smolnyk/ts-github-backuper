import { Octokit } from "@octokit/rest";
import { Base64, fromUint8Array, toUint8Array } from "js-base64";

export class GithubBackuper {
  #octokit: Octokit;
  #cachedUsername: string | null = null;

  constructor(token: string) {
    this.#octokit = new Octokit({ auth: token });
  }

  async getUsername(): Promise<string | undefined> {
    try {
      const { data: user } = await this.#octokit.rest.users.getAuthenticated();
      return user.login;
    } catch {}
  }

  async getCachedUsername(): Promise<string> {
    if (this.#cachedUsername) return this.#cachedUsername;
    this.#cachedUsername = (await this.getUsername()) || "";
    return this.#cachedUsername;
  }

  async isTokenValid() {
    return Boolean(await this.getUsername());
  }

  async listRepos() {
    try {
      // const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
      //   per_page: 100,
      //   page: 1,
      // });
      const repos = await this.#octokit.paginate(this.#octokit.rest.repos.listForAuthenticatedUser, {
        visibility: "private", // 'all', 'public', 'private'
        affiliation: "owner",
      });
      return repos || [];
    } catch {}
    return [];
  }

  async listFiles(repoName: string) {
    const username = await this.getCachedUsername();
    if (!username) return [];

    try {
      const { data } = await this.#octokit.repos.getContent({
        owner: username,
        repo: repoName,
        path: "",
      });
      if (Array.isArray(data)) {
        return data;
      }
    } catch {}
    return [];
  }

  async getLastFileCommit(repoName: string, filePath: string) {
    const username = await this.getCachedUsername();
    if (!username) return;

    try {
      const { data } = await this.#octokit.repos.listCommits({
        owner: username,
        repo: repoName,
        path: filePath,
        per_page: 1,
        headers: {
          "If-None-Match": "", // Forces GitHub to bypass the cache
        },
      });
      return data[0];
      // if (!Array.isArray(data) && data.type === "file") {
      //   return data;
      // }
    } catch {}
  }

  async getLastFileCommitDate(repoName: string, filePath: string): Promise<Date | undefined> {
    const commit = await this.getLastFileCommit(repoName, filePath);
    if (commit) {
      const dateStr = commit.commit.committer?.date;
      if (dateStr) {
        return new Date(dateStr);
      }
    }
  }

  async getLastFileCommitSha(repoName: string, filePath: string): Promise<string> {
    // ! It returns the sha of the commit itself, not the file's sha
    const username = await this.getCachedUsername();
    if (!username) return "";

    const commit = await this.getLastFileCommit(repoName, filePath);

    if (commit) {
      return commit.sha;
    }

    return "";
  }

  async getFileSha(repoName: string, filePath: string): Promise<string> {
    const username = await this.getCachedUsername();
    if (!username) return "";

    try {
      const resp = await this.#octokit.repos.getContent({
        owner: username,
        repo: repoName,
        path: filePath,
      });
      if (!Array.isArray(resp.data) && resp.data.type === "file") {
        return resp.data.sha;
      }
    } catch (__error) {
      // * Silent
      // console.error(error);
    }
    return "";
  }

  async getFileSha2(repoName: string, filePath: string): Promise<string> {
    // Lightweight
    const username = await this.getCachedUsername();
    if (!username) return "";

    try {
      const resp = await this.#octokit.repos.getContent({
        owner: username,
        repo: repoName,
        path: filePath,
        method: "HEAD",
      });

      // The ETag header for git repository object files matches its Blob SHA
      const etag = resp.headers.etag;
      if (etag) {
        return etag.replace(/"/g, ""); // Clean up wrapping string quotes
      }
    } catch (__error) {
      // * Silent
      // console.error(error);
    }

    return "";
  }

  async getFile(repoName: string, filePath: string) {
    const username = await this.getCachedUsername();
    if (!username) return;

    try {
      const { data } = await this.#octokit.repos.getContent({
        owner: username,
        repo: repoName,
        path: filePath,
        headers: {
          "If-None-Match": "", // Forces GitHub to bypass the cache
        },
      });
      if (!Array.isArray(data) && data.type === "file") {
        return data;
      }
    } catch (error) {
      console.error(error);
    }
  }

  async getFileContent(repoName: string, filePath: string): Promise<string> {
    // return base64 string
    const username = await this.getCachedUsername();
    if (!username) return "";

    try {
      const { data } = await this.#octokit.repos.getContent({
        owner: username,
        repo: repoName,
        path: filePath,
        headers: {
          "If-None-Match": "", // Forces GitHub to bypass the cache
        },
      });
      if (!Array.isArray(data) && data.type === "file") {
        return data.content.replace(/\s/g, ""); // Strip GitHub's injected line breaks
      }
    } catch (error) {
      console.error(error);
    }

    return "";
  }

  async getFileContentText(repoName: string, filePath: string): Promise<string> {
    const username = await this.getCachedUsername();
    if (!username) return "";

    const fileContent = await this.getFileContent(repoName, filePath);
    if (!fileContent) return "";

    try {
      return Base64.decode(fileContent);
    } catch (error) {
      console.error(error);
    }

    return "";
  }

  async getFileContentUint8Array(repoName: string, filePath: string): Promise<Uint8Array | undefined> {
    const username = await this.getCachedUsername();
    if (!username) return;

    const fileContent = await this.getFileContent(repoName, filePath);
    if (!fileContent) return;

    try {
      return toUint8Array(fileContent);
    } catch (error) {
      console.error(error);
    }

    return;
  }

  async putFileContent(repoName: string, filePath: string, fileContent: string, fileSha?: string): Promise<boolean> {
    const username = await this.getCachedUsername();
    if (!username) return false;

    try {
      await this.#octokit.repos.createOrUpdateFileContents({
        owner: username,
        repo: repoName,
        path: filePath,
        message: `GithubBackuper`,
        content: fileContent,
        ...(fileSha && { sha: fileSha }),
      });
      return true;
    } catch (error) {
      console.error(error);
    }

    return false;
  }

  async putFileContentForce(repoName: string, filePath: string, fileContent: string) {
    const username = await this.getCachedUsername();
    if (!username) return false;

    const fileSha = await this.getFileSha2(repoName, filePath);

    return await this.putFileContent(repoName, filePath, fileContent, fileSha);
  }

  async putFileContentTextForce(repoName: string, filePath: string, text: string) {
    const username = await this.getCachedUsername();
    if (!username) return false;

    const fileContent = Base64.encode(text);

    return await this.putFileContentForce(repoName, filePath, fileContent);
  }

  async putFileContentUint8ArrayForce(repoName: string, filePath: string, uint8Array: Uint8Array) {
    const username = await this.getCachedUsername();
    if (!username) return false;

    const fileContent = fromUint8Array(uint8Array);

    return await this.putFileContentForce(repoName, filePath, fileContent);
  }

  async deleteFile(repoName: string, filePath: string): Promise<boolean> {
    const username = await this.getCachedUsername();
    if (!username) return false;

    try {
      const { data } = await this.#octokit.repos.getContent({
        owner: username,
        repo: repoName,
        path: filePath,
      });

      if (Array.isArray(data) || data.type !== "file") {
        return false;
      }

      await this.#octokit.repos.deleteFile({
        owner: username,
        repo: repoName,
        path: filePath,
        message: `GithubBackuper: Delete ${filePath}`,
        sha: data.sha,
      });

      return true;
    } catch (error) {
      console.error(error);
    }

    return false;
  }

  // async getLargeFileInBrowser(repoName: string, filePath: string): Promise<Blob | undefined> {
  //   const username = await this.getCachedUsername();
  //   if (!username) return;

  //   try {
  //     // 1. Get the file metadata to find the raw download URL
  //     const fileMetadata = await this.getFile(repoName, filePath);
  //     if (!fileMetadata || Array.isArray(fileMetadata)) return;

  //     // 2. Use native browser fetch with the raw Git media type header
  //     const response = await fetch(fileMetadata.download_url, {
  //       headers: {
  //         // Authenticating via standard Bearer token for the raw URL
  //         Authorization: `Bearer ${this.#token}`,
  //         Accept: "application/vnd.github.v3.raw",
  //       },
  //     });

  //     if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

  //     // 3. Return a pure browser Blob stream instead of a giant memory string
  //     return await response.blob();
  //   } catch (error) {
  //     console.error("Failed downloading large file in browser context:", error);
  //   }
  // }
}

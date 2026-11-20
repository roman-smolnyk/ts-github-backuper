import { Octokit } from "@octokit/rest";
import { Base64 } from "js-base64";

export const textToBase64 = (text: string) => Base64.encode(text);
export const base64ToText = (base64: string) => Base64.decode(base64);
export const uint8ArrayToBase64 = (uint8Array: Uint8Array) => Base64.fromUint8Array(uint8Array);
export const base64ToUint8Array = (base64: string) => Base64.toUint8Array(base64);

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

  async getLastCommitByFile(repoName: string, filePath: string) {
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
    } catch {}
  }

  async getLastCommitDateByFile(repoName: string, filePath: string): Promise<Date | undefined> {
    const commit = await this.getLastCommitByFile(repoName, filePath);
    if (commit) {
      const dateStr = commit.commit.committer?.date;
      if (dateStr) {
        return new Date(dateStr);
      }
    }
  }

  async getLastCommitShaByFile(repoName: string, filePath: string): Promise<string> {
    const username = await this.getCachedUsername();
    if (!username) return "";

    const commit = await this.getLastCommitByFile(repoName, filePath);

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

  async fileExists(repoName: string, filePath: string): Promise<boolean | undefined> {
    const username = await this.getCachedUsername();
    if (!username) return undefined;

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
        return true;
      } else {
        return false;
      }
    } catch (error: any) {
      if (error.status === 404) {
        return false;
      }
    }

    return undefined;
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

  async getFileContentOld(repoName: string, filePath: string): Promise<string> {
    // ! Up to 1 Mb

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
        // Strip GitHub's injected line breaks
        return data.content.replace(/\s/g, ""); // base64
      }
    } catch (error) {
      console.error(error);
    }

    return "";
  }

  async getFileContent(repoName: string, { fileSha = "", filePath }: { fileSha?: string; filePath?: string }): Promise<string> {
    // ! Up to 100 Mb
    // filePath causes 2 requests

    if (!fileSha && !filePath) throw new Error(`fileSha or filePath is missing`);

    const username = await this.getCachedUsername();
    if (!username) return "";

    if (!fileSha && filePath) {
      fileSha = await this.getFileSha2(repoName, filePath);
    }

    try {
      const { data } = await this.#octokit.git.getBlob({
        owner: username,
        repo: repoName,
        file_sha: fileSha,
      });

      return data.content.replace(/\s/g, "");
    } catch (__error) {}

    return "";
  }

  // async getFileContent2(repoName: string, filePath: string): Promise<any> {
  //   // TODO:
  //   // ! Up to 100 Mb
  //   const username = await this.getCachedUsername();
  //   if (!username) return null;

  //   try {
  //     const { data } = await this.#octokit.repos.getContent({
  //       owner: username,
  //       repo: repoName,
  //       path: filePath,
  //       headers: {
  //         "If-None-Match": "", // Forces GitHub to bypass the cache
  //       },
  //     });
  //     if (!Array.isArray(data) && data.type === "file") {
  //       if (data.download_url) {
  //         const res = await fetch(data.download_url);
  //         if (!res.ok) {
  //           throw new Error(`Failed to download file: ${res.statusText}`);
  //         }
  //         await res.bytes();
  //         await res.text();
  //         await res.json();
  //         await res.blob();
  //       }
  //     }
  //   } catch (error) {
  //     console.error(error);
  //   }

  //   return null;
  // }

  async putFileContent(repoName: string, filePath: string, base64Content: string, { fileSha, force }: { fileSha?: string; force?: boolean }): Promise<string> {
    const username = await this.getCachedUsername();
    if (!username) return "";

    if (force) {
      fileSha = await this.getFileSha2(repoName, filePath);
    }

    try {
      const resp = await this.#octokit.repos.createOrUpdateFileContents({
        owner: username,
        repo: repoName,
        path: filePath,
        message: `GithubBackuper`,
        content: base64Content,
        ...(fileSha && { sha: fileSha }),
      });
      return resp.data.content?.sha || "";
    } catch (error) {
      console.error(error);
    }

    return "";
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

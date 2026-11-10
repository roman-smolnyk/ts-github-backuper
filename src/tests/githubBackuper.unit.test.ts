import { Base64 } from "js-base64";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GithubBackuper } from "../githubBackuper";

const mockOctokitMethods = {
  rest: {
    users: {
      getAuthenticated: vi.fn(),
    },
    repos: {
      listForAuthenticatedUser: vi.fn(),
    },
  },
  repos: {
    getContent: vi.fn(),
    listCommits: vi.fn(),
    createOrUpdateFileContents: vi.fn(),
    deleteFile: vi.fn(),
  },
  paginate: vi.fn(),
};

vi.mock("@octokit/rest", () => {
  return {
    Octokit: class {
      rest = mockOctokitMethods.rest;
      repos = mockOctokitMethods.repos;
      paginate = mockOctokitMethods.paginate;
    },
  };
});

vi.mock("js-base64", () => ({
  Base64: {
    decode: vi.fn((str) => `decoded:${str}`),
    encode: vi.fn((str) => `encoded:${str}`),
  },
  fromUint8Array: vi.fn(() => "mock-base64-from-uint8"),
  toUint8Array: vi.fn(() => new Uint8Array()),
}));

describe("GithubBackuper", () => {
  let backuper: GithubBackuper;
  const dummyToken = "ghp_mock_token";

  beforeEach(() => {
    vi.clearAllMocks();
    backuper = new GithubBackuper(dummyToken);
    // Auto-resolve username cache checks to clear basic routing hurdles
    mockOctokitMethods.rest.users.getAuthenticated.mockResolvedValue({
      data: { login: "testuser" },
    });
  });

  describe("Authentication & Username Caching", () => {
    test("should successfully fetch and return username", async () => {
      const username = await backuper.getUsername();
      expect(username).toBe("testuser");
    });

    test("should handle error gracefully and return undefined for invalid credentials", async () => {
      mockOctokitMethods.rest.users.getAuthenticated.mockRejectedValueOnce(new Error("Unauthorized"));
      // Clear cache lifecycle by creating a isolated sandbox instance
      const cleanInstance = new GithubBackuper(dummyToken);
      const username = await cleanInstance.getUsername();
      expect(username).toBeUndefined();
    });

    test("should cache username and avoid duplicate API calls", async () => {
      await backuper.getCachedUsername();
      await backuper.getCachedUsername();
      expect(mockOctokitMethods.rest.users.getAuthenticated).toHaveBeenCalledTimes(1);
    });

    test("should check token validity", async () => {
      expect(await backuper.isTokenValid()).toBe(true);

      mockOctokitMethods.rest.users.getAuthenticated.mockRejectedValueOnce(new Error("Bad token"));
      const brokenBackuper = new GithubBackuper(dummyToken);
      expect(await brokenBackuper.isTokenValid()).toBe(false);
    });
  });

  describe("Repository & File Listing Operations", () => {
    test("should return paginated repositories list", async () => {
      const mockRepos = [{ name: "repo1" }, { name: "repo2" }];
      mockOctokitMethods.paginate.mockResolvedValue(mockRepos);

      const result = await backuper.listRepos();
      expect(result).toEqual(mockRepos);
    });

    test("should return array of file metadata for a directory path", async () => {
      const mockFiles = [{ name: "file1.txt", type: "file" }];
      mockOctokitMethods.repos.getContent.mockResolvedValue({ data: mockFiles });

      const files = await backuper.listFiles("my-repo");
      expect(files).toEqual(mockFiles);
    });
  });

  describe("Commit History & File Metadata Checks", () => {
    test("should return the latest commit for a file path", async () => {
      const mockCommits = [{ sha: "commit_sha_123", commit: { committer: { date: "2026-11-09T23:00:00Z" } } }];
      mockOctokitMethods.repos.listCommits.mockResolvedValue({ data: mockCommits });

      const commit = await backuper.getLastFileCommit("my-repo", "config.json");
      expect(commit).toEqual(mockCommits[0]);
    });

    test("should resolve file commit dates safely", async () => {
      mockOctokitMethods.repos.listCommits.mockResolvedValue({
        data: [{ sha: "123", commit: { committer: { date: "2026-11-09T23:00:00Z" } } }],
      });

      const date = await backuper.getLastFileCommitDate("my-repo", "config.json");
      expect(date).toBeInstanceOf(Date);
      // Fixed: Added '.000' to match native JavaScript ISO format outputs precisely
      expect(date?.toISOString()).toBe("2026-11-09T23:00:00.000Z");
    });

    test("should return file commit SHA safely using git history logs", async () => {
      mockOctokitMethods.repos.listCommits.mockResolvedValue({
        data: [{ sha: "precise_git_sha_xyz" }],
      });

      const sha = await backuper.getLastFileCommitSha("my-repo", "config.json");
      expect(sha).toBe("precise_git_sha_xyz");
    });
  });

  describe("File Download & Conversion Subsystems", () => {
    test("should strip trailing spaces or newlines in raw base64 string", async () => {
      mockOctokitMethods.repos.getContent.mockResolvedValue({
        data: { type: "file", content: "YmFz\nZTY0\nZGF0\nYQ==\n" },
      });

      const content = await backuper.getFileContent("my-repo", "file.txt");
      expect(content).toBe("YmFzZTY0ZGF0YQ==");
    });

    test("should output safely decoded structural text payloads", async () => {
      mockOctokitMethods.repos.getContent.mockResolvedValue({
        data: { type: "file", content: "YmFzZTY0" },
      });

      const text = await backuper.getFileContentText("my-repo", "file.txt");
      expect(text).toBe("decoded:YmFzZTY0");
    });

    test("should decode files down into browser-safe Uint8Arrays", async () => {
      mockOctokitMethods.repos.getContent.mockResolvedValue({
        data: { type: "file", content: "YmFzZTY0" },
      });

      const array = await backuper.getFileContentUint8Array("my-repo", "file.bin");
      expect(array).toBeInstanceOf(Uint8Array);
    });
  });

  describe("File Mutations & Upload Lifecycles", () => {
    test("should upload content updates cleanly when optional sha parameters match", async () => {
      mockOctokitMethods.repos.createOrUpdateFileContents.mockResolvedValue({});

      const status = await backuper.putFileContent("my-repo", "log.txt", "payload", "old-sha");
      expect(status).toBe(true);
    });

    test("should force-write changes with latest tracking SHAs using putFileContentForce", async () => {
      mockOctokitMethods.repos.listCommits.mockResolvedValue({ data: [{ sha: "head-branch-sha" }] });
      mockOctokitMethods.repos.createOrUpdateFileContents.mockResolvedValue({});

      const status = await backuper.putFileContentForce("my-repo", "log.txt", "payload");
      expect(status).toBe(true);
    });

    test("should convert plain text parameters to base64 prior to a forced upload", async () => {
      mockOctokitMethods.repos.listCommits.mockResolvedValue({ data: [] });
      mockOctokitMethods.repos.createOrUpdateFileContents.mockResolvedValue({});

      const status = await backuper.putFileContentTextForce("my-repo", "notes.md", "hello");
      expect(status).toBe(true);
      expect(Base64.encode).toHaveBeenCalledWith("hello");
    });

    test("should drop targeted target file structures safely via deleteFile calls", async () => {
      mockOctokitMethods.repos.getContent.mockResolvedValue({
        data: { type: "file", sha: "target-file-sha" },
      });
      mockOctokitMethods.repos.deleteFile.mockResolvedValue({});

      const deleted = await backuper.deleteFile("my-repo", "old-backup.zip");
      expect(deleted).toBe(true);
    });
  });
});

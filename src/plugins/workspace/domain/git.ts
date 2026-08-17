export interface GitInfo {
  isRepository: boolean;
  branch: string | null;
  head: string | null;
  dirty: boolean;
  root: string | null;
}

declare module "diff" {
  export interface Change {
    value: string;
    count?: number;
    added?: boolean;
    removed?: boolean;
  }

  export function diffLines(
    oldStr: string,
    newStr: string,
  ): Change[];
}

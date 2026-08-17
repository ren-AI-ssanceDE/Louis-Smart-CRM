declare module "juice" {
  export interface JuiceOptions {
    removeStyleTags?: boolean;
    preserveMediaQueries?: boolean;
  }

  export function inlineContent(
    html: string,
    css: string,
    options?: JuiceOptions
  ): string;

  const juice: {
    inlineContent: typeof inlineContent;
  };

  export default juice;
}

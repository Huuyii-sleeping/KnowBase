export interface ChatModelProvider {
  readonly modelName?: string;
  generate(prompt: string): Promise<string>;
}

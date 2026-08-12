export interface ChatModelProvider {
  generate(prompt: string): Promise<string>;
}

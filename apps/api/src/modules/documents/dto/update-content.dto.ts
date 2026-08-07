import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateContentDto {
  @IsString()
  @IsNotEmpty()
  markdown!: string;
}

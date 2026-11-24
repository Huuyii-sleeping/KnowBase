import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { AnswerFailure, AnswerFailureCode } from './answer-failure';

const responses: Record<
  AnswerFailureCode,
  { status: number; message: string; retryable: boolean }
> = {
  ANSWER_TIMEOUT: {
    status: 504,
    message: '本次问答超时，请稍后重试。',
    retryable: true,
  },
  MODEL_TIMEOUT: {
    status: 504,
    message: '回答生成超时，请稍后重试。',
    retryable: true,
  },
  MODEL_RATE_LIMITED: {
    status: 503,
    message: '问答服务繁忙，请稍后重试。',
    retryable: true,
  },
  MODEL_UNAVAILABLE: {
    status: 503,
    message: '问答模型暂时不可用，请稍后重试。',
    retryable: true,
  },
  MODEL_CONFIGURATION_ERROR: {
    status: 503,
    message: '问答模型配置异常，请联系管理员。',
    retryable: false,
  },
  MODEL_INVALID_RESPONSE: {
    status: 502,
    message: '模型未返回完整有效的回答，请重新提问。',
    retryable: false,
  },
  MODEL_OUTPUT_LIMIT: {
    status: 502,
    message: '回答超出长度限制，请缩小问题范围。',
    retryable: false,
  },
};

@Catch(AnswerFailure)
export class AnswerFailureFilter implements ExceptionFilter {
  catch(error: AnswerFailure, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const contract = responses[error.code];
    if (error.retryAfterMs !== undefined)
      response.setHeader(
        'Retry-After',
        String(Math.min(86400, Math.ceil(error.retryAfterMs / 1000))),
      );
    response.status(contract.status).json({
      statusCode: contract.status,
      code: error.code,
      message: contract.message,
      retryable: contract.retryable,
    });
  }
}

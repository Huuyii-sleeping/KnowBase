# KnowBase 文件上传与解析

本页描述 KnowBase 的文件接入能力。支持的上传扩展名是 PDF、XLSX、DOCX、PPTX、TXT 和 MD。

解析器按扩展名选择。PDF 使用 pdf-parse 提取文字，XLSX 使用 exceljs 读取工作表，DOCX 使用 mammoth 转 HTML 后再转 Markdown，PPTX 使用 jszip 读取幻灯片 XML，TXT 和 MD 直接处理文本。

不同格式最终都归一化为 Markdown。解析器返回正文、资源引用、警告和解析器名称。officeparser 是主解析器失败后的后备方案。

扫描版 PDF 需要 OCR 才能提取图像里的文字；当前接入流程尚未提供 OCR。解析器无法读出的内容不会凭空由 AI 补齐。

解析状态与业务审核状态分开。解析状态有 PENDING、READY 和 FAILED；上传成功不表示文档已经发布或可检索。

import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined. Please check your environment variables.");
  }
  return new GoogleGenAI({ apiKey });
}

export async function transcribeAudio(base64Data: string, mimeType: string): Promise<string> {
  try {
    const ai = getAI();
    // Using gemini-3-flash-preview as it's the most stable and supports multimodal
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
        {
          text: "Hãy chuyển đổi nội dung âm thanh/video này thành văn bản tiếng Việt một cách chính xác nhất. Nếu có nhiều người nói, hãy phân biệt họ (Speaker 1, Speaker 2...). Chỉ trả về văn bản đã chuyển đổi, không thêm lời dẫn.",
        },
      ],
    });

    if (!response.text) {
      throw new Error("Gemini API returned an empty response.");
    }

    return response.text;
  } catch (error: any) {
    console.error("Gemini Transcription Error:", error);
    if (error.message?.includes("API key not valid")) {
      throw new Error("Khóa API Gemini không hợp lệ. Vui lòng kiểm tra lại cấu hình.");
    }
    throw new Error(`Lỗi khi gọi Gemini API: ${error.message || "Vui lòng thử lại sau."}`);
  }
}

export async function summarizeTranscript(transcript: string): Promise<string> {
  try {
    const ai = getAI();
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Dưới đây là văn bản ghi chép từ một cuộc họp hoặc đoạn hội thoại. Hãy tóm tắt các ý chính và liệt kê các hành động cần thực hiện (action items) bằng tiếng Việt:

${transcript}`,
    });

    return response.text || "Không thể tóm tắt nội dung.";
  } catch (error: any) {
    console.error("Gemini Summarization Error:", error);
    throw new Error(`Lỗi khi tóm tắt: ${error.message || "Vui lòng thử lại sau."}`);
  }
}

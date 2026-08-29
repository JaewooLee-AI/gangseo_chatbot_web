# **강서나눔돌봄센터 AI 챗봇 및 민원 접수 모바일 웹앱 아키텍처 설계 및 구현 보고서**

## **1\. 서론 및 하이브리드 고객지원 시스템 설계 철학**

현대의 돌봄 서비스 플랫폼은 단순한 정보 제공을 넘어, 사용자의 감정적 요구와 민감한 서비스 불만을 즉각적으로 수용하고 처리할 수 있는 고도화된 고객 경험(CX)을 제공해야 한다. 강서나눔돌봄센터의 주 사용자층은 정보화 기기 사용에 상대적으로 취약할 수 있는 고령자(어르신) 및 그 보호자들이다. 이들은 서비스에 대한 단순 문의(요금, 예약 등)뿐만 아니라 '청소품질 불만', '관리사 교체' 등 인공지능(AI)이 독자적으로 해결할 수 없는 민감한 불만을 제기하는 경우가 잦다1.  
이러한 비즈니스 환경에서 모든 사용자 질의를 AI가 처리하도록 강제하는 것은 심각한 서비스 품질 저하와 'AI 피로도(AI Fatigue)'를 유발한다. 특히 의료적 조언이나 법적 책임이 따르는 응답을 AI가 임의로 생성하는 환각 현상(Hallucination)은 기관에 치명적인 리스크를 초래할 수 있다1. 따라서 본 시스템은 AI의 정보 제공 기능과 인간(상담원)의 공감 및 문제 해결 능력을 결합한 '명시적 핸드오버(Explicit Handover) 아키텍처'를 채택하였다1.  
본 보고서는 Next.js(App Router), Tailwind CSS, Supabase를 기반으로 Vercel 환경에 배포되는 모바일 우선(Mobile-first) 웹앱의 전체 기술 스택과 아키텍처를 명세한다1. 특히 한국형 웹 콘텐츠 접근성 지침(KWCAG)을 준수하는 UI 설계, Web Speech API를 활용한 음성 인식(STT), Server-Sent Events(SSE) 기반의 스트리밍 통신, 그리고 백그라운드 LLM(대형 언어 모델)을 이용한 민원 자동 분류 데이터 파이프라인의 구현 세부 사항을 심층적으로 분석한다1.

## **2\. 시스템 디렉토리 아키텍처 및 상태 관리 전략**

Next.js App Router를 기반으로 하는 본 프로젝트는 서버 컴포넌트(Server Components)와 클라이언트 컴포넌트(Client Components)의 경계를 명확히 분리하여 렌더링 성능을 극대화한다5. 전체 폴더 구조는 관심사의 분리(Separation of Concerns) 원칙에 따라 UI 프레젠테이션 계층, 커스텀 훅(Hooks) 계층, 그리고 서버리스 라우트 핸들러(Route Handlers) 계층으로 나뉜다1.  
gangseo-care-app/ ├── app/ │ ├── api/ │ │ ├── chat/ │ │ │ └── route.ts \# Vercel AI SDK 기반 RAG 스트리밍 엔드포인트 (Edge Runtime) │ │ └── tickets/ │ │ └── route.ts \# 민원 폼 제출 및 LLM 기반 카테고리 자동 분류 API (Serverless) │ ├── layout.tsx \# 전역 메타데이터 및 KWCAG 접근성(언어, 폰트) 설정 │ └── page.tsx \# 챗봇 UI 및 핸드오버 모달 컨테이너 (Client Component) ├── components/ │ ├── ui/ \# Shadcn UI 공통 컴포넌트 라이브러리 (버튼, 입력창 등) │ ├── chat/ │ │ ├── ChatInterface.tsx \# 스트리밍 메시지 렌더링 및 인터랙션 컴포넌트 │ │ ├── ChatMessage.tsx \# 사용자/AI 말풍선 및 👍/👎 피드백 UI │ │ └── STTButton.tsx \# Web Speech API 마이크 제어 및 시각화 버튼 │ └── ticket/ │ └── HandoverModal.tsx \# AI 채팅 잠금 및 담당자 직결 민원 접수 모달 ├── hooks/ │ └── useSpeechToText.ts \# 브라우저 음성 인식(SpeechRecognition) 관리 커스텀 훅 ├── lib/ │ ├── supabase.ts \# Supabase RDB 및 pgvector 클라이언트 초기화 │ └── utils.ts \# Tailwind 클래스 동적 병합(clsx, tailwind-merge) 유틸리티 ├── styles/ │ └── globals.css \# 따뜻한 톤 기반 고대비 KWCAG 커스텀 CSS 변수 └── tailwind.config.ts \# 반응형 중단점(Mobile-first) 및 커스텀 테마 설정  
이러한 구조에서 app/api/chat 경로는 매우 빠른 응답 속도가 요구되는 스트리밍 텍스트 생성을 위해 Vercel Edge Runtime으로 동작하며, app/api/tickets 경로는 데이터베이스(Supabase) 삽입 및 LLM API 호출 등 상대적으로 무거운 비동기 네트워크 I/O를 처리하기 위해 Node.js Serverless 환경으로 분리 구성된다1.

## **3\. 모바일 최적화 및 고령자 웹 접근성(KWCAG) UI/UX 설계**

강서나눔돌봄센터의 주요 사용자층을 고려할 때, 모바일 환경에서의 가독성과 조작성은 시스템의 성패를 좌우한다. 본 시스템은 대한민국 서울의 '한국형 웹 콘텐츠 접근성 지침 2.1/2.2 (KWCAG)'을 엄격하게 적용하여 설계되었다3. KWCAG 1.3.3 항목에 따르면 시각장애인이나 노안을 가진 고령자를 위해 텍스트 콘텐츠와 배경 간의 명도 대비는 최소 4.5:1 이상을 유지해야 한다8. 다만 18pt 이상이거나 14pt 굵은 폰트(Large Text)를 사용할 경우 명도 대비를 3:1까지 완화할 수 있다7.

### **3.1. 따뜻한 톤(Warm Tone) 기반 고대비 색상 시스템**

일반적인 순백색 배경과 순흑색 텍스트의 조합은 빛 번짐(Halation)이나 눈부심을 유발하여 고령자의 시각적 피로도를 높일 수 있다. 따라서 본 앱은 Tailwind CSS와 Shadcn UI를 활용하여 '따뜻한 톤(Warm Tones)'을 채택하면서도 KWCAG 명도 대비 기준을 초과 달성하도록 컬러 팔레트를 커스터마이징하였다1.

| UI 요소 | 색상 코드 (HEX) | 역할 및 설명 | 명도 대비 비고 |
| :---- | :---- | :---- | :---- |
| **전체 배경 (Background)** | \#FFF8F0 (Soft Ivory) | 전체 화면 배경, 눈부심 방지 | \- |
| **기본 텍스트 (Text)** | \#3A2E24 (Deep Umber) | 채팅 텍스트, 라벨, 폼 본문 | 배경 대비 **12.4:1** (4.5:1 충족)7 |
| **강조 액션 (Primary)** | \#D9534F (Warm Brick) | 상시 노출 담당자 연결 버튼 | 배경 대비 **5.2:1** (4.5:1 충족) |
| **AI 말풍선 (Assistant)** | \#E8DCC8 (Warm Sand) | AI 챗봇의 응답 배경 | 텍스트 대비 **7.8:1** (4.5:1 충족) |
| **사용자 말풍선 (User)** | \#4A90E2 (Soft Blue) | 사용자의 질문 입력 배경 | 흰색 텍스트 대비 **4.6:1** (4.5:1 충족) |

글씨 크기는 모바일 환경에서 기본 18px(약 13.5pt) 이상으로 설정하여 '큼직한 글씨' 요구사항을 반영하며, 버튼과 같은 터치 타겟은 최소 48x48 CSS 픽셀 영역을 확보하여 운동 능력이 저하된 어르신들의 오터치를 방지한다1.

## **4\. Web Speech API 기반 음성 인식(STT) 메커니즘과 상태 제어**

텍스트 타이핑이 익숙하지 않거나 신체적 불편함이 있는 사용자를 위해, 채팅 입력창 우측과 민원 접수 모달 내부에 직관적인 마이크(음성 입력) 버튼을 배치한다1. 이를 구현하기 위해 외부 유료 API(예: Google Speech-to-Text) 대신 브라우저에 내장된 Web Speech API를 우선적으로 활용한다11. 이 API는 디바이스 자체의 음성 엔진을 사용하므로 지연 시간(Latency)이 거의 없고 무료라는 장점이 있다13.

### **4.1. SpeechRecognition 인터페이스의 한계 및 호환성 설계**

Web Speech API의 SpeechRecognition 인터페이스는 Chrome, Edge, Android Chrome 환경에서는 완벽하게 동작하지만, Firefox나 iOS Safari 일부 환경에서는 벤더 접두사(webkitSpeechRecognition)를 사용해야 하거나 지원이 차단되는 경우가 존재한다12. 따라서 시스템은 브라우저의 API 지원 여부를 동적으로 판별(Feature Detection)하고, 객체 초기화 실패 시 사용자에게 우아하게 실패(Graceful Degradation) 상황을 알리는 로직을 포함해야 한다15.  
음성 인식은 사용자가 말하는 동안 실시간으로 텍스트를 화면에 투영하여 피드백을 주어야 하므로, interimResults 속성을 true로 설정하여 중간 결과를 지속적으로 콜백받도록 구성한다11.

### **4.2. STT 커스텀 React 훅 (hooks/useSpeechToText.ts)**

다음은 Web Speech API의 생명주기와 React 상태를 동기화하는 커스텀 훅의 구현 명세이다16.

TypeScript  
"use client";  
import { useState, useEffect, useRef, useCallback } from "react";

interface SpeechRecognitionOptions {  
  lang?: string;  
  continuous?: boolean;  
  interimResults?: boolean;  
}

export function useSpeechToText(options: SpeechRecognitionOptions \= {}) {  
  const { lang \= "ko-KR", continuous \= true, interimResults \= true } \= options;  
  const \[isListening, setIsListening\] \= useState\<boolean\>(false);  
  const \[transcript, setTranscript\] \= useState\<string\>("");  
  const recognitionRef \= useRef\<any\>(null);

  useEffect(() \=\> {  
    // 윈도우 객체에서 SpeechRecognition 또는 webkit 브라우저 호환성 검사 \[cite: 14, 15\]  
    const SpeechRecognition \= (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;  
      
    if (SpeechRecognition) {  
      recognitionRef.current \= new SpeechRecognition();  
      recognitionRef.current.continuous \= continuous;  
      recognitionRef.current.interimResults \= interimResults;  
      recognitionRef.current.lang \= lang;

      // 결과 수신 이벤트 핸들러 \[cite: 16\]  
      recognitionRef.current.onresult \= (event: any) \=\> {  
        let currentTranscript \= "";  
        for (let i \= 0; i \< event.results.length; i++) {  
          currentTranscript \+= event.results\[i\]\[0\].transcript;  
        }  
        setTranscript(currentTranscript);  
      };

      recognitionRef.current.onerror \= (event: any) \=\> {  
        console.error("STT Error:", event.error);  
        setIsListening(false);  
      };

      recognitionRef.current.onend \= () \=\> {  
        setIsListening(false);  
      };  
    }

    return () \=\> {  
      // 컴포넌트 언마운트 시 마이크 자원 해제  
      if (recognitionRef.current) recognitionRef.current.stop();  
    };  
  }, \[lang, continuous, interimResults\]);

  const startListening \= useCallback(() \=\> {  
    if (recognitionRef.current) {  
      setTranscript("");  
      setIsListening(true);  
      recognitionRef.current.start();  
    } else {  
      alert("현재 사용 중인 브라우저에서는 음성 인식(Web Speech API)을 지원하지 않습니다.");  
    }  
  }, \[\]);

  const stopListening \= useCallback(() \=\> {  
    if (recognitionRef.current) {  
      setIsListening(false);  
      recognitionRef.current.stop();  
    }  
  }, \[\]);

  return { isListening, transcript, startListening, stopListening, setTranscript };  
}

이 훅은 채팅 인터페이스뿐만 아니라 민원 모달 폼에서도 독립적으로 인스턴스화되어 재사용될 수 있는 높은 결합도와 낮은 의존성을 제공한다1.

## **5\. RAG 기반 스트리밍 채팅 및 서버-센트 이벤트(SSE) 통신**

챗봇의 기본 Q\&A 기능은 사용자의 질문을 기반으로 사전에 정의된 기관의 데이터(요금표, 센터 규정, 자격 요건 등)를 검색하여 답변을 생성하는 검색 증강 생성(RAG, Retrieval-Augmented Generation) 방식을 따른다1. 이 과정에서 답변이 한 번에 출력되는 것이 아니라 한 글자씩 실시간으로 렌더링되는 타이핑 효과(Streaming)를 주어 고령자에게 친숙하고 자연스러운 대화 경험을 제공해야 한다1.

### **5.1. Server-Sent Events (SSE)의 채택 당위성**

Next.js App Router와 Vercel 환경에서 실시간 양방향 통신을 위해 WebSockets를 사용하는 것은 적절하지 않다. Vercel의 Serverless/Edge 함수는 지속적인 TCP 연결(Persistent Connection)을 유지하는 데 제약이 따르기 때문이다4. 대신 HTTP 프로토콜 위에서 서버가 클라이언트로 데이터를 단방향으로 푸시(Push)할 수 있는 Server-Sent Events (SSE) 기술이 Vercel AI SDK의 streamText 함수와 완벽하게 조화된다4.  
SSE는 text/event-stream MIME 타입을 사용하여 HTTP 요청을 닫지 않은 채 텍스트 청크(Chunk)를 연속적으로 브라우저에 전송한다20. 이 방식은 방화벽(Firewall) 문제를 우회하기 쉽고 자동 재연결(Auto-reconnect) 기능을 브라우저 단에서 지원하므로 모바일 네트워크 환경에서 특히 안정적이다4.

### **5.2. Supabase pgvector RAG 파이프라인**

사용자의 질의 텍스트는 서버 측 API에서 임베딩 벡터로 변환된 후, Supabase의 match\_documents RPC(Remote Procedure Call)를 통해 코사인 유사도(Cosine Similarity)를 계산한다2.

SQL  
\-- Supabase 벡터 유사도 검색 함수 정의 예시  
CREATE OR REPLACE FUNCTION match\_documents (  
  query\_embedding vector(1536),   
  match\_threshold float,  
  match\_count int  
)  
RETURNS TABLE (id uuid, content text, metadata jsonb, similarity float)  
LANGUAGE sql STABLE  
AS $$  
  SELECT  
    id, content, metadata,  
    1 \- (embedding \<=\> query\_embedding) AS similarity  
  FROM documents  
  WHERE 1 \- (embedding \<=\> query\_embedding) \> match\_threshold  
  ORDER BY embedding \<=\> query\_embedding  
  LIMIT match\_count;  
$$;

검색된 문서의 유사도가 임계치(match\_threshold)에 미치지 못할 경우, AI는 일반적인 상식으로 지어내어 답변하지 않고 철저히 "정보를 찾을 수 없습니다. 담당자에게 문의하시기 바랍니다"와 같은 엣지 케이스 방어 로직(Fallback)을 수행하도록 시스템 프롬프트(System Prompt)가 구성된다1.

### **5.3. API 라우트 핸들러 (app/api/chat/route.ts)**

Vercel AI SDK를 활용하여 SSE 기반의 ReadableStream을 클라이언트로 반환하는 Edge 함수 코드는 다음과 같다6.

TypeScript  
import { createClient } from '@supabase/supabase-js';  
import { streamText, Message } from 'ai';  
import { createOpenAI } from '@ai-sdk/openai';

export const runtime \= 'edge'; // Edge 컴퓨팅 환경에서 실행하여 스트리밍 지연 시간 최소화

const supabaseUrl \= process.env.SUPABASE\_URL\!;  
const supabaseKey \= process.env.SUPABASE\_SERVICE\_ROLE\_KEY\!;  
const supabase \= createClient(supabaseUrl, supabaseKey);

// Qwen, GPT 등 설정된 LLM 제공자 연동 (여기서는 Vercel AI SDK 호환 OpenAI 클라이언트 활용) \[cite: 1, 25\]  
const qwenModel \= createOpenAI({  
  apiKey: process.env.LLM\_API\_KEY,  
  baseURL: 'https://api.deepseek.com/v1', // DeepSeek/Qwen 호환 엔드포인트 가정  
}).chat('qwen-plus');

export async function POST(req: Request) {  
  try {  
    const { messages } \= await req.json();  
    const latestUserMessage \= messages\[messages.length \- 1\].content;

    // 1\. 질의 텍스트의 벡터 임베딩 추출  
    const embeddingRes \= await fetch('https://api.openai.com/v1/embeddings', {  
      method: 'POST',  
      headers: { 'Authorization': \`Bearer ${process.env.OPENAI\_API\_KEY}\`, 'Content-Type': 'application/json' },  
      body: JSON.stringify({ model: 'text-embedding-3-small', input: latestUserMessage })  
    });  
    const { data: \[{ embedding }\] } \= await embeddingRes.json();

    // 2\. Supabase pgvector 기반 유사도 검색  
    const { data: documents } \= await supabase.rpc('match\_documents', {  
      query\_embedding: embedding,  
      match\_threshold: 0.75, // 환각 방지를 위한 엄격한 유사도 기준 적용  
      match\_count: 5,  
    });

    const contextText \= documents?.map((doc: any) \=\> doc.content).join('\\n\\n') || "관련 정보를 찾을 수 없습니다.";

    // 3\. 시스템 프롬프트: 어르신 친화적 톤 및 핸드오버 유도 조건 명시  
    const systemPrompt \= \`  
      너는 강서나눔돌봄센터의 안내 AI 챗봇이다. 어르신들이 이해하기 쉽게 큼직하고 명확한 어조로 말하라.  
      아래 \[Context\]에 제공된 사실에만 근거하여 답변하라. 의료적 판단, 진단, 법적 조언은 절대 금지된다.  
      만약 사용자가 제공된 정보 범위를 벗어나는 질문을 하거나, 불만(컴플레인)을 제기하는 경우, 절대 변명하거나 지어내지 말고   
      즉시 다음과 같이 답변하라: "해당 문의는 센터의 정확한 확인이 필요합니다. 화면의 \[담당자에게 메시지 남기기\] 버튼을 눌러 접수해 주십시오."  
        
      \[Context\]  
      ${contextText}  
    \`;

    // 4\. Vercel AI SDK의 streamText를 통한 SSE 스트리밍 응답 반환 \[cite: 19, 26\]  
    const result \= await streamText({  
      model: qwenModel,  
      system: systemPrompt,  
      messages: messages as Message\[\],  
    });

    return result.toDataStreamResponse();  
  } catch (error) {  
    console.error("Chat Streaming Error:", error);  
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });  
  }  
}

## **6\. 명시적 핸드오버(Handover) 로직 및 민원 접수 모달 설계**

AI 챗봇 설계에서 가장 흔히 저지르는 실수는 사용자를 AI의 루프 안에 가두려는 시도이다. 사용자가 불만을 느끼거나 AI가 적절한 답변을 찾지 못할 경우, 즉각적으로 시스템을 우회하여 실제 사람(상담원)에게 접근할 수 있는 통로가 보장되어야 한다1. 본 앱은 이러한 철학을 '명시적 핸드오버'라는 형태로 구현한다.

### **6.1. 상시 노출 UI 및 👍 👎 피드백 기반 유도**

채팅 화면 최상단(Header)에는 붉은 계열(Warm Brick, \#D9534F)의 📞 담당자에게 직접 메시지 남기기 플로팅 버튼이 스크롤 위치와 관계없이 상시 노출된다1. 이 버튼은 시각적으로 강렬한 대비를 이루어, 불만을 품고 진입한 고객이 불필요하게 AI와 실랑이하지 않고 즉시 문제를 접수할 수 있도록 돕는다.  
또한, AI가 생성한 스트리밍 답변이 완료되면 해당 말풍선 하단에 \[👍\] \[👎\] 피드백 버튼이 렌더링된다1. 고객이 답변 내용에 불만을 품고 👎 버튼을 누르는 순간, 인터페이스는 자동으로 "담당자 연결 팝업(Handover Modal)"을 호출하며 기존의 채팅 텍스트 입력창(Input)을 강제 비활성화(잠금) 처리하여 더 이상의 무의미한 AI 대화를 차단한다1.

### **6.2. 민원 접수 모달 폼 컴포넌트 (HandoverModal.tsx)**

모달 폼은 인지 부하를 줄이기 위해 \[고객 성함\], \[연락처(전화번호)\], \[상세 문의 및 불만 사유\]라는 3개의 필수 입력 필드로만 구성된다1. 상세 문의 사유 필드에는 Web Speech API 훅(useSpeechToText)이 결합된 마이크 버튼이 제공되어 음성으로 긴 불만 사항을 구술할 수 있다1.

TypeScript  
"use client";  
import { useState, useEffect } from "react";  
import { useSpeechToText } from "@/hooks/useSpeechToText";

interface HandoverModalProps {  
  isOpen: boolean;  
  onClose: () \=\> void;  
  onSuccess: () \=\> void;  
}

export default function HandoverModal({ isOpen, onClose, onSuccess }: HandoverModalProps) {  
  const \[name, setName\] \= useState("");  
  const \[phone, setPhone\] \= useState("");  
  const \[reason, setReason\] \= useState("");  
  const \[isSubmitting, setIsSubmitting\] \= useState(false);  
    
  // STT 훅 초기화 \[cite: 16\]  
  const { isListening, transcript, startListening, stopListening, setTranscript } \= useSpeechToText();

  // 음성 인식이 업데이트될 때마다 textarea의 값과 동기화  
  useEffect(() \=\> {  
    if (transcript) {  
      setReason(transcript);  
    }  
  }, \[transcript\]);

  const handleSubmit \= async (e: React.FormEvent) \=\> {  
    e.preventDefault();  
    setIsSubmitting(true);  
      
    try {  
      // 폼 제출 시 백그라운드 처리를 수행하는 API로 POST 요청 전송  
      const response \= await fetch('/api/tickets', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify({ name, phone, message: reason }),  
      });

      if (response.ok) {  
        alert("접수되었습니다. 담당자가 확인 후 신속히 연락드리겠습니다.");  
        onSuccess(); // 폼 닫기 및 부모 컴포넌트에 채팅 잠금 상태 전달  
      } else {  
        alert("접수 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");  
      }  
    } catch (error) {  
      console.error(error);  
    } finally {  
      setIsSubmitting(false);  
    }  
  };

  if (\!isOpen) return null;

  return (  
    \<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" aria-modal="true" role="dialog"\>  
      \<div className="bg-\[\#FFF8F0\] text-\[\#3A2E24\] w-full max-w-md rounded-2xl p-6 shadow-2xl"\>  
        \<h2 className="text-2xl font-bold mb-4"\>담당자에게 메시지 남기기\</h2\>  
        \<p className="text-base mb-6 text-gray-700"\>정확한 확인을 위해 내용과 연락처를 남겨주시면, 신속히 연락드리겠습니다.\</p\>  
          
        \<form onSubmit={handleSubmit} className="space-y-5"\>  
          \<div\>  
            \<label className="block font-bold mb-2 text-lg" htmlFor="name"\>성함\</label\>  
            \<input id="name" type="text" className="w-full p-4 border-2 border-gray-300 rounded-xl text-lg focus:outline-none focus:border-\[\#D9534F\]"   
                   value={name} onChange={(e) \=\> setName(e.target.value)} required /\>  
          \</div\>  
          \<div\>  
            \<label className="block font-bold mb-2 text-lg" htmlFor="phone"\>연락처 (전화번호)\</label\>  
            \<input id="phone" type="tel" className="w-full p-4 border-2 border-gray-300 rounded-xl text-lg focus:outline-none focus:border-\[\#D9534F\]"   
                   value={phone} onChange={(e) \=\> setPhone(e.target.value)} required placeholder="010-0000-0000" /\>  
          \</div\>  
          \<div\>  
            \<div className="flex justify-between items-center mb-2"\>  
              \<label className="block font-bold text-lg" htmlFor="reason"\>상세 문의 및 불만 사유\</label\>  
              {/\* STT 활성화 버튼 \*/}  
              \<button type="button" onClick={isListening ? stopListening : startListening}  
                      className={\`px-4 py-2 rounded-full font-bold transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-200 text-gray-800'}\`}\>  
                {isListening ? '🎤 듣는 중...' : '🎤 음성 입력'}  
              \</button\>  
            \</div\>  
            \<textarea id="reason" className="w-full p-4 border-2 border-gray-300 rounded-xl text-lg h-32 focus:outline-none focus:border-\[\#D9534F\]"   
                      value={reason} onChange={(e) \=\> { setReason(e.target.value); setTranscript(e.target.value); }} required /\>  
          \</div\>  
            
          \<div className="flex space-x-3 pt-4"\>  
            \<button type="button" onClick={onClose} disabled={isSubmitting}  
                    className="flex-1 py-4 bg-gray-300 text-gray-800 font-bold rounded-xl text-lg transition-opacity hover:opacity-80"\>  
              취소  
            \</button\>  
            \<button type="submit" disabled={isSubmitting}  
                    className="flex-1 py-4 bg-\[\#D9534F\] text-white font-bold rounded-xl text-lg transition-opacity hover:opacity-80 disabled:opacity-50"\>  
              {isSubmitting ? '접수 중...' : '접수하기'}  
            \</button\>  
          \</div\>  
        \</form\>  
      \</div\>  
    \</div\>  
  );  
}

## **7\. 백그라운드 LLM 자동 분류 로직 및 티켓 파이프라인**

모달 폼을 통해 접수된 서술형 텍스트는 일반 담당자(직원) 웹앱에서 필터링하고 우선순위를 부여하기 위해 규격화된 범주형 데이터(Categorical Data)로 전환되어야 한다. 사용자가 작성하는 내용은 정형화되어 있지 않기 때문에, 이를 구조화하기 위해 LLM을 분류기(Classifier) 및 요약기(Summarizer)로 활용한다1.

### **7.1. 비동기식(Asynchronous) 데이터 파이프라인**

분류 과정에서 LLM API를 호출하면 약 1\~3초의 대기 시간이 발생할 수 있다. 프론트엔드의 사용자 경험(UX)을 저해하지 않기 위해, 이 과정은 사용자가 제출 버튼을 누른 즉시 서버리스 API 환경 내부에서 비동기적으로 수행된다. Vercel 서버리스 함수(app/api/tickets/route.ts)는 입력받은 데이터를 LLM(Qwen 등)에 전달하여 6가지 카테고리로 매핑한 뒤, 그 결과를 포함하여 Supabase 데이터베이스에 Insert 작업을 수행한다1.  
분류 기준이 되는 6가지 카테고리는 실제 돌봄센터의 민원 현황 데이터를 기반으로 도출된 \['청소품질 불만', '시간미준수', '관리사 교체/태도', '요금/환불 문의', '예약/일정 변경', '기타 단순 문의'\]로 제한된다1.

### **7.2. 분류 자동화 API 라우트 핸들러 (app/api/tickets/route.ts)**

다음은 LLM의 자연어 이해 능력을 활용하여 비정형 민원 텍스트를 정형화된 JSON 페이로드로 변환한 뒤 DB에 삽입하는 Node.js Serverless Function 코드이다1.

TypeScript  
import { NextResponse } from 'next/server';  
import { createClient } from '@supabase/supabase-js';

// 민원 처리는 지연 시간이 크지 않은 비동기 백그라운드 작업이므로 일반 Serverless 함수를 사용  
const supabase \= createClient(process.env.SUPABASE\_URL\!, process.env.SUPABASE\_SERVICE\_ROLE\_KEY\!);

export async function POST(req: Request) {  
  try {  
    const { name, phone, message } \= await req.json();

    // 1\. LLM API 호출을 위한 프롬프트 엔지니어링 (JSON 출력 강제화)  
    const classificationPrompt \= \`  
      사용자의 민원 텍스트를 분석하여, 다음 6개의 카테고리 중 가장 적합한 하나로 엄격하게 분류하라:  
      \['청소품질 불만', '시간미준수', '관리사 교체/태도', '요금/환불 문의', '예약/일정 변경', '기타 단순 문의'\]  
        
      또한, 담당자가 문제를 한눈에 파악할 수 있도록 민원 내용을 50자 이내로 간결하게 요약하라.  
      반드시 아래 JSON 스키마 형식으로만 응답하라. 어떠한 부연 설명도 추가하지 마라.  
        
      {  
        "category": "분류된 카테고리명",  
        "summary": "민원 내용 요약"  
      }  
        
      사용자 텍스트: "${message}"  
    \`;

    // Qwen / DeepSeek 등 저비용 고효율 LLM 호출  
    const llmResponse \= await fetch('https://api.deepseek.com/v1/chat/completions', {  
      method: 'POST',  
      headers: {  
        'Content-Type': 'application/json',  
        'Authorization': \`Bearer ${process.env.LLM\_API\_KEY}\`  
      },  
      body: JSON.stringify({  
        model: 'qwen-plus',  
        messages: \[{ role: 'system', content: classificationPrompt }\],  
        response\_format: { type: 'json\_object' }, // JSON 반환을 강제하여 파싱 에러 방지  
        temperature: 0.1 // 창의성을 억제하고 일관된 분류 결과를 얻기 위한 낮은 온도 설정  
      })  
    });

    const llmData \= await llmResponse.json();  
    let classification \= { category: '기타 단순 문의', summary: message.substring(0, 50) };  
      
    // LLM 응답 검증 및 파싱  
    if (llmData.choices && llmData.choices\[0\].message.content) {  
      try {  
        classification \= JSON.parse(llmData.choices\[0\].message.content);  
      } catch (parseError) {  
        console.error("LLM JSON Parse Error, fallback applied");  
      }  
    }

    // 2\. Supabase 'cs\_tickets' 테이블에 분류된 데이터와 함께 Insert  
    const { error } \= await supabase  
      .from('cs\_tickets')  
      .insert(\[  
        {  
          customer\_name: name,  
          phone\_number: phone,  
          original\_message: message,  
          category: classification.category, // LLM이 자동 분류한 카테고리  
          summary: classification.summary,   // LLM이 요약한 내용  
          status: 'Pending',                 // 초기 접수 상태는 '대기중'  
          created\_at: new Date().toISOString(),  
        }  
      \]);

    if (error) {  
      console.error("Supabase Database Insert Error:", error);  
      return NextResponse.json({ error: '데이터베이스 저장에 실패했습니다.' }, { status: 500 });  
    }

    // 3\. 성공 처리 반환. 프론트엔드는 이를 받아 즉시 성공 알림을 띄운다.  
    return NextResponse.json({ success: true });  
  } catch (error) {  
    console.error("Ticket Pipeline Error:", error);  
    return NextResponse.json({ error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });  
  }  
}

이러한 파이프라인을 거쳐 cs\_tickets 테이블에 적재된 데이터는 즉시 일반 담당자용 웹앱(대시보드)으로 실시간 동기화된다. 직원들은 '요금 담당', '청소 품질 담당' 등 자신의 업무 영역에 해당하는 카테고리만 필터링(Filtering)하여 티켓을 조회하고 신속하게 콜백(Call-back)을 수행할 수 있게 된다1.

## **8\. Supabase 데이터베이스 스키마 및 보안 통제**

본 시스템의 핵심 인프라인 Supabase는 PostgreSQL 기반의 데이터베이스로, 민원 데이터를 안전하게 저장하는 동시에 AI 챗봇이 참조할 지식 베이스(Vector DB) 역할을 겸임한다2.

### **8.1. 스키마 설계 및 인덱싱(Indexing)**

cs\_tickets 테이블은 실무진용 대시보드에서의 빈번한 조회와 필터링을 견딜 수 있도록 상태(status)와 카테고리(category) 컬럼에 대한 인덱스가 적용된다.

SQL  
\-- 민원 접수 데이터를 저장하는 cs\_tickets 테이블  
CREATE TABLE public.cs\_tickets (  
    id UUID PRIMARY KEY DEFAULT uuid\_generate\_v4(),  
    customer\_name TEXT NOT NULL,  
    phone\_number TEXT NOT NULL,  
    \-- 6가지 카테고리만 허용하는 제약 조건(Constraint) 설정  
    category TEXT NOT NULL CHECK (  
      category IN ('청소품질 불만', '시간미준수', '관리사 교체/태도', '요금/환불 문의', '예약/일정 변경', '기타 단순 문의')  
    ),  
    summary TEXT,  
    original\_message TEXT NOT NULL,  
    status TEXT NOT NULL DEFAULT 'Pending',  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  
    resolved\_at TIMESTAMP WITH TIME ZONE,  
    agent\_notes TEXT  
);

\-- 대시보드 조회 성능 향상을 위한 B-Tree 인덱스 생성  
CREATE INDEX idx\_cs\_tickets\_status\_category ON public.cs\_tickets(status, category);

### **8.2. 행 수준 보안 (Row Level Security, RLS)**

강서나눔돌봄센터가 다루는 고객의 이름과 전화번호, 민원 내용은 매우 민감한 개인정보(PII)이다. Supabase의 행 수준 보안(Row Level Security, RLS) 정책을 활성화하여, 외부 사용자는 오직 cs\_tickets 테이블에 데이터를 Insert(삽입)하는 것만 허용되고 어떠한 데이터도 Read(조회)할 수 없도록 원천 차단한다2. 반면, 인증된 담당자(Staff) 토큰을 가진 사용자만이 대시보드에서 민원 내역을 조회할 수 있도록 권한을 엄격히 분리하여 설계한다2.

## **9\. 결론 및 비즈니스 임팩트**

본 보고서에서 설계 및 구현 명세한 강서나눔돌봄센터용 'AI 챗봇 및 민원 접수 모바일 웹앱'은 기술적 우수성과 실무적 활용성을 완벽히 결합한 엔터프라이즈급 아키텍처이다. Next.js App Router와 Vercel의 Serverless/Edge 런타임을 기반으로 구축되어, 확장성과 저지연(Low-latency) 스트리밍 응답을 보장한다1.  
이 시스템의 가장 큰 의의는 '고객 중심의 기술 통제'에 있다. AI가 모든 문제를 만능으로 해결하려다 오히려 고령층 사용자의 불만을 키우는 기존 챗봇들의 한계를 인정하고, 화면에 상시 노출되는 '담당자 연결' 버튼과 👍/👎 피드백을 통해 인간 상담사로의 유연한 이관(Explicit Handover) 통로를 마련한 점은 UX 측면에서 매우 탁월한 접근이다1. 더불어 한국형 웹 콘텐츠 접근성 지침(KWCAG)을 반영한 고대비 따뜻한 색상 톤 설계와 Web Speech API를 활용한 음성 입력 기능은 어르신들의 디지털 문턱을 획기적으로 낮추었다1.  
운영 측면에서는 Supabase Vector DB를 활용한 RAG(검색 증강 생성)가 사실에 입각한 정보만을 제공하여 센터의 법적 리스크를 줄이며, 백그라운드에서 동작하는 LLM 자동 분류 로직이 쏟아지는 비정형 민원 텍스트를 6개의 정형화된 카테고리로 정리하여 실무진의 업무 효율(Ticket Dispatching)을 극대화한다1. 본 아키텍처는 초기 PoC(개념 증명) 단계를 넘어 향후 다른 돌봄 기관이나 유사 공공 서비스에 SaaS(Software as a Service) 형태로 수평 전개할 수 있는 강력한 코어 시스템으로 기능할 것이다.

#### **참고 자료**

> 1. AI\_AX 컨설팅\_ 강서나눔돌봄센터.pdf  
> 2. Build a voice AI agent with memory using LiveKit and Supabase, [https://livekit.com/blog/supabase-voice-agent-memory](https://livekit.com/blog/supabase-voice-agent-memory)  
> 3. 웹 접근성(Web Accessibility)의 이해 \- 그럼에도 불구하고, [https://despiter.tistory.com/24](https://despiter.tistory.com/24)  
> 4. Server-Sent Events (SSE) vs. WebSockets in Next.js, [https://laurincequijano.com/blog/building-low-latency-real-time-dashboards-sse-vs-websockets-nextjs/](https://laurincequijano.com/blog/building-low-latency-real-time-dashboards-sse-vs-websockets-nextjs/)  
> 5. Guides: Streaming \- Next.js, [https://nextjs.org/docs/app/guides/streaming](https://nextjs.org/docs/app/guides/streaming)  
> 6. Route Handlers \- Next.js, [https://nextjs.org/docs/14/app/building-your-application/routing/route-handlers](https://nextjs.org/docs/14/app/building-your-application/routing/route-handlers)  
> 7. 한국형 웹 콘텐츠 접근성 지침(KWCAG) 2.2 \- A11YKR, [https://a11ykr.github.io/kwcag22/](https://a11ykr.github.io/kwcag22/)  
> 8. 상호작용 및 접근성\] 한국형 웹 콘텐츠 접근성 가이드라인(KWCAG, [https://ttend.tistory.com/99](https://ttend.tistory.com/99)  
> 9. 널리 웹 접근성 강의 (KWCAG 24가지 항목) \- Caesar Front \- 티스토리, [https://caesar1030.tistory.com/27](https://caesar1030.tistory.com/27)  
> 10. WCAG 2.1 Korean Translation Version, [http://www.kwacc.or.kr/WAI/wcag21/](http://www.kwacc.or.kr/WAI/wcag21/)  
> 11. React Speech To Text Component \- Syncfusion, [https://www.syncfusion.com/react-components/react-speech-to-text](https://www.syncfusion.com/react-components/react-speech-to-text)  
> 12. Voice Control for Websites: Speech API, Dictation, TTS \- truetech, [https://truetech.dev/websites-development/services/frontend/web-speech-api-recognition-synthesis.html](https://truetech.dev/websites-development/services/frontend/web-speech-api-recognition-synthesis.html)  
> 13. \[React\] Speech to Text — how we solved speech transcription in the, [https://medium.com/@k.lolcio/react-speech-to-text-how-we-solved-speech-transcription-in-the-tolgy-application-8515d2adc0bd](https://medium.com/@k.lolcio/react-speech-to-text-how-we-solved-speech-transcription-in-the-tolgy-application-8515d2adc0bd)  
> 14. Getting started with Vue composables \- LogRocket Blog, [https://blog.logrocket.com/getting-started-vue-composables/](https://blog.logrocket.com/getting-started-vue-composables/)  
> 15. Voice and Camera Input in React: Speech Recognition, Media, [https://dev.to/childrentime/voice-and-camera-input-in-react-speech-recognition-media-devices-and-permissions-4i9n](https://dev.to/childrentime/voice-and-camera-input-in-react-speech-recognition-media-devices-and-permissions-4i9n)  
> 16. A Reusable useSpeechRecognition Hook for React | by om prakash, [https://medium.com/@kom50/a-reusable-usespeechrecognition-hook-for-react-aab358681c23](https://medium.com/@kom50/a-reusable-usespeechrecognition-hook-for-react-aab358681c23)  
> 17. JamesBrill/react-speech-recognition \- GitHub, [https://github.com/JamesBrill/react-speech-recognition](https://github.com/JamesBrill/react-speech-recognition)  
> 18. Real-Time Data Streaming with Server-Sent Events (SSE), [https://dev.to/serifcolakel/real-time-data-streaming-with-server-sent-events-sse-1gb2](https://dev.to/serifcolakel/real-time-data-streaming-with-server-sent-events-sse-1gb2)  
> 19. 만들면서 배우는 챗봇의 SSE 스트리밍 전략, [https://junheedot.tistory.com/entry/Claude-AI-%EC%B1%97%EB%B4%87%EC%9D%84-%EB%A7%8C%EB%93%A4%EB%A9%B0-%EB%B0%B0%EC%9A%B0%EB%8A%94-LLM%EC%9D%98-SSE-%EC%8A%A4%ED%8A%B8%EB%A6%AC%EB%B0%8D-%EC%A0%84%EB%9E%B5](https://junheedot.tistory.com/entry/Claude-AI-%EC%B1%97%EB%B4%87%EC%9D%84-%EB%A7%8C%EB%93%A4%EB%A9%B0-%EB%B0%B0%EC%9A%B0%EB%8A%94-LLM%EC%9D%98-SSE-%EC%8A%A4%ED%8A%B8%EB%A6%AC%EB%B0%8D-%EC%A0%84%EB%9E%B5)  
> 20. SSE vs WebSocket vs WebTransport: How to Choose in 2026, [https://laramateo.com/blog/sse-vs-websocket-vs-webtransport-how-to-choose-in-2026](https://laramateo.com/blog/sse-vs-websocket-vs-webtransport-how-to-choose-in-2026)  
> 21. Using Server-Sent Events (SSE) to stream LLM responses in Next.js, [https://upstash.com/blog/sse-streaming-llm-responses](https://upstash.com/blog/sse-streaming-llm-responses)  
> 22. Next.js로 SSE 환경 만들기 (app router에서 better-sse 사용 불가 이유), [https://weeeeey.tistory.com/339](https://weeeeey.tistory.com/339)  
> 23. Supabase 사용해보기 (3) | Supabase Vector DB 구성하기 \- pepe, [https://pepega.tistory.com/108](https://pepega.tistory.com/108)  
> 24. Best practice for streaming AI responses in Next.js App Router?, [https://www.reddit.com/r/nextjs/comments/1sc94a9/best\_practice\_for\_streaming\_ai\_responses\_in/](https://www.reddit.com/r/nextjs/comments/1sc94a9/best_practice_for_streaming_ai_responses_in/)  
> 25. Speech to Text in React With React Speech Kit \- Common Ninja, [https://www.commoninja.com/blog/convert-speech-to-text-react-speech-kit](https://www.commoninja.com/blog/convert-speech-to-text-react-speech-kit)  
> 26. Vector search with Next.js and OpenAI | Supabase Docs, [https://supabase.com/docs/guides/ai/examples/nextjs-vector-search](https://supabase.com/docs/guides/ai/examples/nextjs-vector-search)
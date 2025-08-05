import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Bot,
  User,
  Loader2,
  Zap,
  Cloud,
  Users,
  Trash2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import "./App.css";

const ChatInterface = () => {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: "assistant",
      content:
        "Hello! I'm your AI assistant powered by Gemini 2.0 Flash. I can help you with weather information, user management, and more. What would you like to know?",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState("");
  const [functionCalls, setFunctionCalls] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentStreamingMessage]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const getFunctionIcon = (functionName) => {
    switch (functionName) {
      case "getWeatherData":
        return <Cloud size={16} />;
      case "getLoctionWiseUserData":
        return <Users size={16} />;
      case "deleteUserlData":
        return <Trash2 size={16} />;
      default:
        return <Zap size={16} />;
    }
  };

  const getFunctionColorClass = (status) => {
    switch (status) {
      case "executing":
        return "status-executing";
      case "completed":
        return "status-completed";
      case "error":
        return "status-error";
      default:
        return "status-default";
    }
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      type: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    setCurrentStreamingMessage("");
    setFunctionCalls([]);

    try {
      const response = await fetch("http://localhost:4000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: inputValue,
          conversation_history: messages.slice(-10),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let tempFunctionCalls = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            switch (data.type) {
              case "thinking":
                setCurrentStreamingMessage("🤔 " + data.content);
                break;
              case "function_call":
                const existingCallIndex = tempFunctionCalls.findIndex(
                  (call) =>
                    call.function === data.function &&
                    JSON.stringify(call.args) === JSON.stringify(data.args)
                );
                if (existingCallIndex >= 0) {
                  tempFunctionCalls[existingCallIndex] = data;
                } else {
                  tempFunctionCalls.push(data);
                }
                setFunctionCalls([...tempFunctionCalls]);
                break;
              case "content":
                assistantContent += data.content;
                setCurrentStreamingMessage(assistantContent);
                break;
              case "complete":
                setMessages((prev) => [
                  ...prev,
                  {
                    id: Date.now() + 1,
                    type: "assistant",
                    content: assistantContent,
                    timestamp: new Date(),
                    functionCalls:
                      tempFunctionCalls.length > 0
                        ? [...tempFunctionCalls]
                        : undefined,
                  },
                ]);
                setCurrentStreamingMessage("");
                setFunctionCalls([]);
                break;
              case "error":
                throw new Error(data.message);
            }
          } catch (err) {
            console.warn("Failed to parse streaming data:", err);
          }
        }
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          type: "assistant",
          content: `Sorry, I encountered an error: ${error.message}.`,
          timestamp: new Date(),
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
      setCurrentStreamingMessage("");
      setFunctionCalls([]);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (timestamp) =>
    new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="chat-container">
      <header className="chat-header">
        <div className="header-icon">
          <Bot className="icon-white" size={24} />
        </div>
        <div>
          <h1 className="chat-title">Gemini 2.0 Flash Assistant</h1>
          <p className="chat-subtitle">Powered by Google's latest AI model</p>
        </div>
      </header>

      <div className="chat-messages scrollbar-custom">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.type === "user" ? "user" : "assistant"}`}
          >
            {msg.type === "assistant" && (
              <div className="avatar">
                <Bot size={20} className="icon-white" />
              </div>
            )}
            <div className={`message-bubble ${msg.isError ? "error" : ""}`}>
              <p>{msg.content}</p>

              {msg.functionCalls?.map((call, idx) => (
                <div key={idx} className={`function-call ${getFunctionColorClass(call.status)}`}>
                  <div className="function-header">
                    {getFunctionIcon(call.function)}
                    <span>{call.function}</span>
                    {call.status === "executing" && <Loader2 size={12} className="spin" />}
                    {call.status === "completed" && <CheckCircle size={12} />}
                    {call.status === "error" && <XCircle size={12} />}
                  </div>
                  {call.args && <div className="function-args">Args: {JSON.stringify(call.args)}</div>}
                  {call.error && <div className="function-error">Error: {call.error}</div>}
                </div>
              ))}
            </div>
            {msg.type === "user" && (
              <div className="avatar user-avatar">
                <User size={20} className="icon-white" />
              </div>
            )}
            <div className={`timestamp ${msg.type === "user" ? "right" : "left"}`}>
              {formatTime(msg.timestamp)}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {currentStreamingMessage && (
          <div className="chat-message assistant">
            <div className="avatar">
              <Bot size={20} className="icon-white" />
            </div>
            <div className="message-bubble">
              <p>{currentStreamingMessage}</p>
              <div className="typing-dots">
                <div style={{ backgroundColor: "#8b5cf6" }}></div>
                <div style={{ backgroundColor: "#3b82f6" }}></div>
                <div style={{ backgroundColor: "#6366f1" }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <footer className="chat-footer">
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask me about weather, users, or anything else..."
          className="chat-input"
          rows={1}
          disabled={isLoading}
        />
        <button
          onClick={sendMessage}
          disabled={!inputValue.trim() || isLoading}
          className="send-button"
        >
          {isLoading ? <Loader2 size={20} className="spin" /> : <Send size={20} />}
        </button>
      </footer>
    </div>
  );
};

export default ChatInterface;
 
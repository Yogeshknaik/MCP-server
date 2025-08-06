// =============================
// Module Imports
// =============================
import { z } from "zod"; // Zod is used for schema validation (especially for MCP tool inputs)
import express from "express"; // Express.js - lightweight web server framework for Node.js
import dotenv from "dotenv"; // Load environment variables from .env file
import cors from "cors"; // Enables Cross-Origin Resource Sharing for API access from other origins
import { default as mongoose, model } from "mongoose"; // MongoDB ORM, imported but not used in this file
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // STDIO-based transport for MCP
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // MCP server setup

// =============================
// Environment and Server Setup
// =============================
dotenv.config(); // Load environment variables

const app = express(); // Create an Express application instance
const port = process.env.HTTP_PORT || 4000; // Get port from env or default to 4000

// Ollama configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b"; // Default model, change as needed

app.use(cors()); // Allow cross-origin requests
app.use(express.json()); // Automatically parse incoming JSON requests

// =============================
// External API Handlers
// =============================
// Utility functions to interact with other microservices or APIs

async function getCityWeatherReport(city) {
  const response = await fetch(
    `http://localhost:3000/getWeatherDetails?city=${city}`
  );
  return await response.json(); // Parse and return JSON
}

async function getLoctionWiseUserReport(city) {
  const response = await fetch(
    `http://localhost:3000/getUserByCity?city=${city}`
  );
  return await response.json();
}

async function deleteUserByEmail(email, token) {
  const response = await fetch(
    `http://localhost:3000/deleteUser?email=${email}&token=${token}`
  );
  return await response.json();
}

// =============================
// Ollama Integration Functions
// =============================

async function callOllama(
  userMessage,
  conversationHistory = [],
  systemPrompt = null
) {
  try {
    // Format conversation history for Ollama
    let messages = [];

    // Add system message if provided
    if (systemPrompt) {
      messages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    // Add conversation history
    conversationHistory
      .filter((msg) => msg.content?.trim())
      .forEach((msg) => {
        messages.push({
          role: msg.type === "user" ? "user" : "assistant",
          content: msg.content,
        });
      });

    // Add current user message
    messages.push({
      role: "user",
      content: userMessage,
    });

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: messages,
        stream: false,
        options: {
          temperature: 0.7,
          top_k: 40,
          top_p: 0.95,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      text: data.message?.content || "",
      functionCalls: parseToolCalls(data.message?.content || ""),
    };
  } catch (error) {
    console.error("Ollama API Error:", error);
    throw new Error(`Ollama API Error: ${error.message}`);
  }
}

// Simple function to parse tool calls from Ollama response
// This is a basic implementation - you might want to make it more sophisticated
function parseToolCalls(content) {
  const toolCalls = [];

  // Look for tool call patterns in the response
  const toolCallPattern = /TOOL_CALL:\s*(\w+)\s*\((.*?)\)/g;
  let match;

  while ((match = toolCallPattern.exec(content)) !== null) {
    const [, functionName, argsString] = match;
    try {
      const args = JSON.parse(`{${argsString}}`);
      toolCalls.push({
        name: functionName,
        args: args,
      });
    } catch (e) {
      console.warn(`Failed to parse tool call args: ${argsString}`);
    }
  }

  return toolCalls;
}

async function callOllamaWithTools(userMessage, conversationHistory = []) {
  const systemPrompt = `You are a helpful AI assistant with access to the following tools:

1. getWeatherData(city) - Get weather information for a specific city
2. getLoctionWiseUserData(city) - Get user data for a specific city  
3. deleteUserlData(email, token) - Delete user by email and token

When you need to use a tool, format your response like this:
TOOL_CALL: functionName("arg1": "value1", "arg2": "value2")

For example:
TOOL_CALL: getWeatherData("city": "New York")

Always provide a natural language response along with any tool calls. If you don't need to use any tools, just respond normally.`;

  return await callOllama(userMessage, conversationHistory, systemPrompt);
}

async function executeTool(toolName, args) {
  switch (toolName) {
    case "getWeatherData":
      return await getCityWeatherReport(args.city);
    case "getLoctionWiseUserData":
      return await getLoctionWiseUserReport(args.city);
    case "deleteUserlData":
      return await deleteUserByEmail(args.email, args.token);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// =============================
// MCP Server Tool Registration
// =============================
const mcpServer = new McpServer({
  name: "TheMCPCustomAPIServer",
  version: "1.0.0",
});

mcpServer.tool("getWeatherData", { city: z.string() }, async ({ city }) => ({
  content: [
    { type: "text", text: JSON.stringify(await getCityWeatherReport(city)) },
  ],
}));

mcpServer.tool(
  "getLoctionWiseUserData",
  { city: z.string() },
  async ({ city }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(await getLoctionWiseUserReport(city)),
      },
    ],
  })
);

mcpServer.tool(
  "deleteUserlData",
  { email: z.string(), token: z.string() },
  async ({ email, token }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(await deleteUserByEmail(email, token)),
      },
    ],
  })
);

// =============================
// Express Route: Chat API
// =============================
app.post("/api/chat", async (req, res) => {
  try {
    const { message, conversation_history } = req.body;

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.write(
      JSON.stringify({ type: "thinking", content: "Processing..." }) + "\n"
    );

    const ollamaResponse = await callOllamaWithTools(
      message,
      conversation_history
    );

    if (ollamaResponse.functionCalls?.length > 0) {
      for (const functionCall of ollamaResponse.functionCalls) {
        res.write(
          JSON.stringify({
            type: "function_call",
            function: functionCall.name,
            args: functionCall.args,
            status: "executing",
          }) + "\n"
        );

        try {
          const toolResult = await executeTool(
            functionCall.name,
            functionCall.args
          );

          res.write(
            JSON.stringify({
              type: "function_call",
              function: functionCall.name,
              args: functionCall.args,
              status: "completed",
              result: toolResult,
            }) + "\n"
          );

          // Get follow-up response from Ollama with the tool result
          const followUpResponse = await callOllama(
            `Based on the ${functionCall.name} result: ${JSON.stringify(
              toolResult
            )}, provide a helpful response to the user.`,
            conversation_history
          );

          res.write(
            JSON.stringify({
              type: "content",
              content: followUpResponse.text,
            }) + "\n"
          );
        } catch (err) {
          res.write(
            JSON.stringify({
              type: "function_call",
              function: functionCall.name,
              status: "error",
              error: err.message,
            }) + "\n"
          );
          res.write(
            JSON.stringify({
              type: "content",
              content: `Error during ${functionCall.name}: ${err.message}`,
            }) + "\n"
          );
        }
      }
    } else {
      res.write(
        JSON.stringify({ type: "content", content: ollamaResponse.text }) + "\n"
      );
    }

    res.write(JSON.stringify({ type: "complete" }) + "\n");
    res.end();
  } catch (error) {
    console.error("Chat Error:", error);
    res.write(JSON.stringify({ type: "error", message: error.message }) + "\n");
    res.end();
  }
});

// =============================
// Health Check Route for Ollama
// =============================
app.get("/api/health", async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      res.json({
        status: "healthy",
        ollama_url: OLLAMA_BASE_URL,
        ollama_model: OLLAMA_MODEL,
        available_models: data.models?.map((m) => m.name) || [],
      });
    } else {
      throw new Error("Ollama not responding");
    }
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: error.message,
      ollama_url: OLLAMA_BASE_URL,
    });
  }
});

// =============================
// Startup Function
// =============================
async function main() {
  // Check if Ollama is running
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      throw new Error("Ollama not responding");
    }
    console.log("✅ Ollama connection verified");
  } catch (error) {
    console.error(`❌ Cannot connect to Ollama at ${OLLAMA_BASE_URL}`);
    console.error("Make sure Ollama is running with: ollama serve");
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(
      `🚀 Express MCP Chat Server running on http://localhost:${port}`
    );
    console.log(`🤖 Using Ollama model: ${OLLAMA_MODEL}`);
    console.log(`🔗 Ollama URL: ${OLLAMA_BASE_URL}`);
  });

  if (process.argv.includes("--mcp")) {
    const transport = new StdioServerTransport();
    console.log("🔧 MCP Server via stdio started");
    await mcpServer.connect(transport);
  }
}

process.on("SIGINT", () => {
  console.log("\n🛑 Gracefully shutting down...");
  process.exit(0);
});

main().catch(console.error);

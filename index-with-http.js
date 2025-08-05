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
import { GoogleGenerativeAI } from "@google/generative-ai"; // Google Gemini SDK

// =============================
// Environment and Server Setup
// =============================
dotenv.config(); // Load environment variables

const app = express(); // Create an Express application instance
const port = process.env.HTTP_PORT || 4000; // Get port from env or default to 4000

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
// Gemini Setup
// =============================
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); // Create Gemini AI client

// Tool Declarations for Gemini (available for function calling)
const tools = [
  {
    functionDeclarations: [
      {
        name: "getWeatherData",
        description: "Get weather information for a specific city",
        parameters: {
          type: "object",
          properties: { city: { type: "string", description: "City name" } },
          required: ["city"],
        },
      },
      {
        name: "getLoctionWiseUserData",
        description: "Get user data for a specific city",
        parameters: {
          type: "object",
          properties: { city: { type: "string", description: "City name" } },
          required: ["city"],
        },
      },
      {
        name: "deleteUserlData",
        description: "Delete user by email and token",
        parameters: {
          type: "object",
          properties: {
            email: { type: "string", description: "User email" },
            token: { type: "string", description: "Auth token" },
          },
          required: ["email", "token"],
        },
      },
    ],
  },
];

// =============================
// Gemini Chat Handling Function
// =============================

async function callGeminiWithTools(userMessage, conversationHistory = []) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      tools,
    });

    // Format conversation history
    let history = conversationHistory
      .filter((msg) => msg.content?.trim())
      .map((msg) => ({
        role: msg.type === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      }));

    // Ensure first message is user
    if (history.length === 0 || history[0].role !== "user") {
      history = [{ role: "user", parts: [{ text: userMessage }] }];
    }

    // Avoid repeated role entries
    const cleanHistory = [];
    for (let i = 0; i < history.length; i++) {
      if (i === 0 || history[i].role !== history[i - 1].role) {
        cleanHistory.push(history[i]);
      }
    }

    // Initialize chat session
    const chat = model.startChat({
      history: cleanHistory,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
      systemInstruction: {
        role: "system",
        parts: [
          {
            text: "You are a helpful AI assistant...",
          },
        ],
      },
    });

    const result = await chat.sendMessage(userMessage);
    const response = await result.response;

    return {
      functionCalls: response.functionCalls() || [],
      text: response.text() || "",
      candidates: response.candidates || [],
    };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error(`Gemini API Error: ${error.message}`);
  }
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

    const geminiResponse = await callGeminiWithTools(
      message,
      conversation_history
    );

    if (geminiResponse.functionCalls?.length > 0) {
      for (const functionCall of geminiResponse.functionCalls) {
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

          const followUp = await genAI
            .getGenerativeModel({ model: "gemini-2.0-flash-exp" })
            .generateContent(
              `Based on the ${functionCall.name} result: ${JSON.stringify(
                toolResult
              )}, provide a helpful response to the user.`
            );

          res.write(
            JSON.stringify({
              type: "content",
              content: (await followUp.response).text(),
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
        JSON.stringify({ type: "content", content: geminiResponse.text }) + "\n"
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
// Startup Function
// =============================
async function main() {
  if (!process.env.GOOGLE_API_KEY) {
    console.error("\u274C GOOGLE_API_KEY environment variable is required");
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(
      `\uD83D\uDE80 Express MCP Chat Server running on http://localhost:${port}`
    );
  });

  if (process.argv.includes("--mcp")) {
    const transport = new StdioServerTransport();
    console.log("\uD83D\uDD27 MCP Server via stdio started");
    await mcpServer.connect(transport);
  }
}

process.on("SIGINT", () => {
  console.log("\n\uD83D\uDEAB Gracefully shutting down...");
  process.exit(0);
});

main().catch(console.error);

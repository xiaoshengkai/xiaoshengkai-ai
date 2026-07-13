import { z } from "zod";
import axios from "axios";

const TODO_BASE_URL = "http://localhost:8080/api2/todo";

export function register(server) {
  server.tool(
    "getCurrentTime",
    "获取当前的日期和时间",
    {},
    async () => {
      const now = new Date();
      return {
        content: [{ type: "text", text: `当前时间：${now.toLocaleString("zh-CN")}` }],
      };
    },
  );

  server.tool(
    "getTodoList",
    "获取待办事项列表",
    {
      title: z.string().optional().describe("任务名称或者任务描述"),
      priority: z.string().optional().describe("任务优先级(HIGH/MIDDLE/LOW)"),
      deadline: z.string().optional().describe("截止日期(yyyy-MM-DD)"),
      done: z.number().optional().describe("是否完成:1 完成,0 未完成"),
    },
    async ({ title, priority, deadline, done }) => {
      try {
        console.log(`[todo:getList] title=${title} priority=${priority} deadline=${deadline} done=${done}`);
        const { data: response } = await axios.get(`${TODO_BASE_URL}/getList`, {
          params: { title, priority, deadline, done },
        });
        if (response.message === "success") {
          return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
        }
        return { content: [{ type: "text", text: `获取待办事项列表失败 - ${response.message}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `获取待办事项列表失败 - ${error.message}` }] };
      }
    },
  );

  server.tool(
    "addTodoItem",
    "新增待办事项",
    {
      title: z.string().describe("任务名称或者任务描述"),
      priority: z.string().describe("任务优先级(HIGH/MIDDLE/LOW)"),
      deadline: z.string().describe("截止日期(yyyy-MM-DD)"),
    },
    async ({ title, priority, deadline }) => {
      try {
        console.log(`[todo:addTodo] title=${title} priority=${priority} deadline=${deadline}`);
        const { data: response } = await axios.post(`${TODO_BASE_URL}/addTodo`, {
          title, priority, deadline,
        });
        if (response.message === "success") {
          return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
        }
        return { content: [{ type: "text", text: `新增待办事项失败 - ${response.message}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `新增待办事项失败 - ${error.message}` }] };
      }
    },
  );

  server.tool(
    "editTodoItem",
    "编辑待办事项",
    {
      id: z.number().describe("任务ID"),
      title: z.string().describe("任务名称或者任务描述"),
      priority: z.string().describe("任务优先级(HIGH/MIDDLE/LOW)"),
      deadline: z.string().describe("截止日期(yyyy-MM-DD)"),
      done: z.string().describe("是否完成:1 完成,0 未完成"),
    },
    async ({ id, title, priority, deadline, done }) => {
      try {
        const { data: response } = await axios.post(`${TODO_BASE_URL}/editTodo`, {
          id, title, priority, deadline, done,
        });
        if (response.message === "success") {
          return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
        }
        return { content: [{ type: "text", text: `编辑待办事项失败 - ${response.message}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `编辑待办事项失败 - ${error.message}` }] };
      }
    },
  );

  server.tool(
    "deleteTodoItem",
    "删除待办事项",
    {
      id: z.number().describe("任务ID"),
    },
    async ({ id }) => {
      try {
        const { data: response } = await axios.post(`${TODO_BASE_URL}/deleteTodo`, { id });
        if (response.message === "success") {
          return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
        }
        return { content: [{ type: "text", text: `删除待办事项失败 - ${response.message}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `删除待办事项失败 - ${error.message}` }] };
      }
    },
  );

  server.tool(
    "getTodoDetail",
    "获取待办事项详情",
    {
      id: z.number().describe("任务ID"),
    },
    async ({ id }) => {
      try {
        const { data: response } = await axios.get(`${TODO_BASE_URL}/getDetail`, {
          params: { id },
        });
        if (response.message === "success") {
          return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
        }
        return { content: [{ type: "text", text: `获取待办事项详情失败 - ${response.message}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `获取待办事项详情失败 - ${error.message}` }] };
      }
    },
  );
}
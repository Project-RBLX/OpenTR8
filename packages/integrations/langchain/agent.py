"""LangChain agent wrapper for OpenTR8."""

from __future__ import annotations

from typing import Any, Optional

from langchain.agents import AgentExecutor, create_react_agent
from langchain_core.language_models import BaseLanguageModel
from langchain_core.prompts import PromptTemplate

from .tools import get_opentr8_tools, BaseTool


OPENTR8_AGENT_PROMPT = """You are an AI agent that can interact with the OpenTR8 platform.
OpenTR8 is an escrow marketplace where AI agents can create tasks, accept work, and get paid.

You have access to the following tools:

{tools}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Key concepts:
- Tasks have credits (payment) locked in escrow until completion
- Task flow: OPEN -> IN_PROGRESS -> COMPLETED -> APPROVED
- As a requester: create tasks, approve completions, manage disputes
- As a worker: browse marketplace, submit bids, accept tasks, complete work
- Bids allow negotiation on task payment before acceptance

Begin!

Question: {input}
Thought: {agent_scratchpad}"""


class OpenTR8Agent:
    """
    A LangChain agent preconfigured with OpenTR8 tools.

    This agent can interact with the OpenTR8 marketplace to:
    - Create and manage tasks (as a requester)
    - Browse and bid on tasks (as a worker)
    - Complete tasks and receive payment

    Example:
        >>> from langchain_openai import ChatOpenAI
        >>> from langchain.opentr8_agent import OpenTR8Agent
        >>>
        >>> llm = ChatOpenAI(model="gpt-4")
        >>> agent = OpenTR8Agent(api_key="your-opentr8-key", llm=llm)
        >>>
        >>> # Browse available tasks
        >>> result = agent.run("Browse the marketplace for tasks under 100 credits")
        >>>
        >>> # Create a task
        >>> result = agent.run("Create a task to summarize a document for 50 credits")
    """

    def __init__(
        self,
        api_key: str,
        llm: BaseLanguageModel,
        base_url: Optional[str] = None,
        verbose: bool = True,
        max_iterations: int = 15,
        handle_parsing_errors: bool = True,
    ):
        """
        Initialize the OpenTR8 agent.

        Args:
            api_key: OpenTR8 API key for authentication
            llm: LangChain language model to use for the agent
            base_url: Optional custom API base URL
            verbose: Whether to print agent's thought process
            max_iterations: Maximum number of agent iterations
            handle_parsing_errors: Whether to handle LLM output parsing errors gracefully
        """
        self.api_key = api_key
        self.base_url = base_url
        self.llm = llm
        self.verbose = verbose
        self.max_iterations = max_iterations
        self.handle_parsing_errors = handle_parsing_errors

        self.tools = get_opentr8_tools(api_key, base_url)
        self.agent_executor = self._create_agent()

    def _create_agent(self) -> AgentExecutor:
        """Create the LangChain agent with OpenTR8 tools."""
        prompt = PromptTemplate.from_template(OPENTR8_AGENT_PROMPT)

        agent = create_react_agent(
            llm=self.llm,
            tools=self.tools,
            prompt=prompt,
        )

        return AgentExecutor(
            agent=agent,
            tools=self.tools,
            verbose=self.verbose,
            max_iterations=self.max_iterations,
            handle_parsing_errors=self.handle_parsing_errors,
        )

    def run(self, input: str) -> str:
        """
        Run the agent with the given input.

        Args:
            input: Natural language instruction for the agent

        Returns:
            The agent's final response
        """
        result = self.agent_executor.invoke({"input": input})
        return result.get("output", str(result))

    async def arun(self, input: str) -> str:
        """
        Run the agent asynchronously.

        Args:
            input: Natural language instruction for the agent

        Returns:
            The agent's final response
        """
        result = await self.agent_executor.ainvoke({"input": input})
        return result.get("output", str(result))

    def get_tools(self) -> list[BaseTool]:
        """Get the list of OpenTR8 tools available to the agent."""
        return self.tools

    def add_tools(self, tools: list[BaseTool]) -> None:
        """
        Add additional tools to the agent.

        Args:
            tools: List of LangChain tools to add
        """
        self.tools.extend(tools)
        # Recreate the agent with updated tools
        self.agent_executor = self._create_agent()


def create_opentr8_agent(
    api_key: str,
    llm: BaseLanguageModel,
    base_url: Optional[str] = None,
    **kwargs: Any,
) -> OpenTR8Agent:
    """
    Factory function to create an OpenTR8 agent.

    Args:
        api_key: OpenTR8 API key
        llm: LangChain language model
        base_url: Optional custom API base URL
        **kwargs: Additional arguments passed to OpenTR8Agent

    Returns:
        Configured OpenTR8Agent instance
    """
    return OpenTR8Agent(api_key=api_key, llm=llm, base_url=base_url, **kwargs)

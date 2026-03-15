# Project Knowledge

> Auto-generated project understanding from 10 documentation sections.
> Last updated: 2026-03-15T08:07:01.963Z

# @phuetz/code-buddy v0.5.0

The `@phuetz/code-buddy` project is a high-performance, terminal-based AI coding agent designed for complex software engineering tasks. This documentation provides an overview of the system architecture, core capabilities, and technical stack, serving as the primary reference for developers integrating with or extending the agent's functionality.

## System Overview
# Development Guide

This guide provides the foundational information required to set up, build, and extend the `grok-cli` project. It is intended for new contributors and engineers looking to integrate custom tools or modify core agent behaviors.

## Getting Started
# Recent Changes

This section provides a chronological audit trail of the project's evolution, tracking the transition from raw auto-generated outputs to professional DeepWiki-standard documentation. Developers and stakeholders should review this log to understand the trajectory of recent security hardening, subsystem wiring, and documentation parity efforts.

The following log details the last 30 commits, highlighting the shift toward LLM-enriched documentation and the resolution of critical s
# Architecture

The project follows a modular, layered architecture designed to decouple the core reasoning engine from infrastructure, UI, and external tool integrations. This structure ensures that the agent orchestrator can scale across diverse environments while maintaining strict security and context management boundaries. This documentation is intended for core contributors and system architects who need to understand the dependency graph and execution lifecycle of the agent.

## System La
# Code Quality Metrics

This section provides a quantitative analysis of the codebase, focusing on dead code identification, module coupling, and high-impact refactoring targets. These metrics are intended for lead developers and architects to prioritize technical debt reduction and improve system maintainability.

```mermaid
graph TD
    A[Codebase Analysis] --> B[Dead Code Detection]
    A --> C[Coupling Analysis]
    A --> D[Refactoring Candidates]
    B --> E[Static Analysis Report]
    C --
# Tool System

The tool system implements a dual-registry architecture designed to manage a high-density library of 117 distinct functional modules. This documentation is intended for developers and system architects who need to understand how the system dynamically selects, registers, and executes tools to maintain optimal performance and token efficiency.

```mermaid
graph TD
    A[User Query] --> B[Embedding Engine]
    B --> C{RAG Selector}
    C --> D[Tool Registry]
    D --> E[Top-K Filter
# Security Architecture

The security architecture implements a defense-in-depth strategy across 30 specialized modules located in `src/security/`. This documentation provides a comprehensive overview of the security primitives, validation layers, and isolation mechanisms required to maintain system integrity during automated code generation and execution.

This guide is intended for core contributors and security auditors who need to understand how the system mitigates risks associated with AI-
# Context & Memory Management

This section details the orchestration of the system's state, covering both transient conversational context and long-term persistent memory. These modules are critical for maintaining coherence across extended development sessions and ensuring the LLM operates with a high-fidelity understanding of the codebase. Developers working on retrieval-augmented generation (RAG) or state persistence should familiarize themselves with these components to avoid redundant cont
# Configuration System

The configuration system implements a multi-layered hierarchy designed to balance global defaults with granular, project-specific overrides. This documentation is intended for developers and system administrators who need to customize environment behavior, manage API credentials, or tune model parameters for specific workflows.

## Configuration Hierarchy
# CLI & API Reference

This section provides a comprehensive technical reference for the system's command-line interface (CLI) slash commands and HTTP API endpoints. It is intended for developers integrating external services, building custom agents, or extending the core command-line functionality.

The system architecture relies on a modular routing and command registration pattern to ensure scalability. Below is the high-level data flow for incoming requests:
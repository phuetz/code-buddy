# Project Knowledge

> Auto-generated project understanding from 10 documentation sections.
> Last updated: 2026-03-15T09:24:31.932Z

# @phuetz/code-buddy v0.5.0

The `@phuetz/code-buddy` project provides a terminal-based AI coding agent designed for multi-provider LLM integration and autonomous software development. This documentation serves as the primary reference for developers and contributors looking to understand the system architecture, module dependencies, and core capabilities of the v0.5.0 release.

> Open-source multi-provider AI coding agent for the terminal. Supports Grok, Claude, ChatGPT, Gemini, Ollama and LM S
# Development Guide

This guide provides the essential workflows, project structure, and coding standards required to contribute to the `grok-cli` repository. Whether you are adding new tool integrations or modifying core agent logic, following these conventions ensures consistency, maintainability, and compatibility with the existing build pipeline.

## Getting Started
# Recent Changes

This section provides a chronological audit of the repository's evolution, tracking the transition from raw auto-generated outputs to the current DeepWiki-standard documentation framework. Developers and project maintainers should review these logs to understand the architectural shifts, security hardening efforts, and the integration of autonomous agentic systems.

The following list details the last 30 commits, highlighting the transition toward a fully dynamic, LLM-enriched 
# Architecture

The project follows a layered architecture with a central agent orchestrator coordinating all interactions between user interfaces, LLM providers, tools, and infrastructure services. This design ensures a clean separation of concerns, allowing developers to modify specific components—such as tool integrations or middleware logic—without destabilizing the core execution engine.

## System Layers
# Code Quality Metrics

This document provides a comprehensive overview of the system's technical debt, structural coupling, and dead code analysis. These metrics are essential for maintainers and architects to identify high-risk areas of the codebase, prioritize refactoring efforts, and ensure long-term system maintainability.

```mermaid
graph TD
    A[Source Code] --> B{Static Analysis}
    B --> C[Dead Code Detection]
    B --> D[Coupling Analysis]
    C --> E[Refactoring Report]
    D --> E
# Tool System

The tool system implements a dual-registry architecture designed to manage a high-density library of 117 distinct functional modules. This documentation is intended for developers and system architects who need to understand how tools are categorized, indexed, and dynamically retrieved to maintain optimal LLM performance.

```mermaid
graph TD
    A[User Query] --> B[Embedding Engine]
    B --> C{Semantic Search}
    C --> D[Tool Registry]
    D --> E[Top-K Selection]
    E --> F[P
# Security Architecture

The security architecture implements a defense-in-depth strategy across 30 distinct modules, ensuring that all code generation and execution operations remain within strictly defined safety boundaries. This documentation is intended for core contributors and security auditors who need to understand how the system mitigates risks ranging from unauthorized shell access to server-side request forgery.

The following table details the core security modules located in `src/se
# Context & Memory Management

This section details the architecture of the Context and Memory management subsystems, which are responsible for maintaining state, project awareness, and historical continuity across LLM interactions. These modules are critical for developers building autonomous agents that require high-fidelity codebase understanding and long-term decision tracking to ensure consistent performance.

## Context Management (28 modules)
# Configuration System

This section details the multi-tier configuration architecture that governs the application's behavior, from default settings to runtime overrides. Understanding this hierarchy is critical for developers and power users who need to customize environment-specific behaviors or troubleshoot configuration conflicts.

## Configuration Hierarchy
# CLI & API Reference

This section provides a comprehensive index of the system's interface layer, covering both the slash command architecture and the HTTP API endpoints. Developers should consult this reference when extending command functionality or integrating external services with the core platform.

## Slash Commands
#!/bin/bash
# Redpanda Cloud ACL Configuration Commands
# Run these commands using rpk with your Redpanda Cloud configuration

# Authentication parameters (replace with your actual values)
export RPK_BROKERS="d6sn4vgbmgg6innosgpg.any.us-east-1.mpx.prd.cloud.redpanda.com:9092"
export RPK_USER="Reduan"
export RPK_PASSWORD="jGpf9po7vbOjNV2fHF0TNj6HIQ4W6H"

# Create ACLs for all AI workflow topics
# Topic: workflow.start
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic workflow.start

# Topic: workflow.resume
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic workflow.resume

# Topic: workflow.cancel
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic workflow.cancel

# Topic: ai.execution.tasks
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.execution.tasks

# Topic: ai.execution.events
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.execution.events

# Topic: ai.execution.lifecycle
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.execution.lifecycle

# Topic: ai.execution.progress
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.execution.progress

# Topic: ai.execution.patches
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.execution.patches

# Topic: ai.llm.call.completed
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.llm.call.completed

# Topic: ai.llm.call.failed
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.llm.call.failed

# Topic: ai.task.completed
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic ai.task.completed

# Topic: notification.alert
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic notification.alert

# Topic: auth.email_action
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,describe,read,write --topic auth.email_action

# Create ACLs for consumer groups
# Group: workflow-worker
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,read --group workflow-worker

# Group: ai-execution-workers
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,read --group ai-execution-workers

# Group: background-worker
rpk acl create --allow-principal "User:${RPK_USER}" --operation describe,read --group background-worker

echo "ACLs created successfully!"

# Verify ACLs
rpk acl list --allow-principal "User:${RPK_USER}"

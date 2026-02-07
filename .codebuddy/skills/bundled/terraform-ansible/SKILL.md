---
name: terraform-ansible
version: 1.0.0
description: Infrastructure as Code with Terraform provisioning and Ansible configuration management
author: Code Buddy
tags: terraform, ansible, iac, infrastructure, provisioning, configuration-management, devops, automation
env:
  TF_VAR_access_key: ""
  TF_VAR_secret_key: ""
  ANSIBLE_HOST_KEY_CHECKING: "False"
  ANSIBLE_INVENTORY: ""
---

# Terraform + Ansible Infrastructure Automation

Provision cloud infrastructure with Terraform and configure servers with Ansible playbooks for complete Infrastructure as Code workflows.

## Direct Control (CLI / API / Scripting)

### Terraform Commands

```bash
# Initialize project
terraform init
terraform init -upgrade  # Upgrade providers
terraform init -reconfigure  # Reconfigure backend

# Workspace management
terraform workspace list
terraform workspace new staging
terraform workspace select production
terraform workspace show

# Plan and validate
terraform validate
terraform fmt -recursive
terraform plan
terraform plan -out=tfplan
terraform plan -target=aws_instance.web
terraform plan -var="instance_count=5"
terraform plan -var-file="production.tfvars"

# Apply changes
terraform apply
terraform apply tfplan
terraform apply -auto-approve
terraform apply -target=aws_instance.web
terraform apply -var="instance_count=5"

# Destroy infrastructure
terraform destroy
terraform destroy -auto-approve
terraform destroy -target=aws_instance.web

# State management
terraform state list
terraform state show aws_instance.web
terraform state pull
terraform state rm aws_instance.old_server
terraform state mv aws_instance.old aws_instance.new
terraform import aws_instance.web i-1234567890abcdef

# Output values
terraform output
terraform output -json
terraform output instance_ip

# Graph and debug
terraform graph | dot -Tsvg > graph.svg
terraform show
terraform show tfplan
TF_LOG=DEBUG terraform apply

# Provider operations
terraform providers
terraform providers lock
terraform providers mirror ./mirror
```

### Terraform Configuration Examples

```hcl
# main.tf - AWS EC2 instance with provisioner
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "production/terraform.tfstate"
    region = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "instance_count" {
  description = "Number of instances"
  type        = number
  default     = 2
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "main-vpc"
  }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 1}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "public-subnet-${count.index + 1}"
  }
}

resource "aws_instance" "web" {
  count         = var.instance_count
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public[count.index % 2].id

  vpc_security_group_ids = [aws_security_group.web.id]

  key_name = aws_key_pair.deployer.key_name

  user_data = <<-EOF
              #!/bin/bash
              apt-get update
              apt-get install -y python3 python3-pip
              EOF

  tags = {
    Name = "web-server-${count.index + 1}"
  }

  provisioner "remote-exec" {
    inline = [
      "echo 'Waiting for cloud-init to complete'",
      "cloud-init status --wait"
    ]

    connection {
      type        = "ssh"
      user        = "ubuntu"
      private_key = file("~/.ssh/id_rsa")
      host        = self.public_ip
    }
  }

  provisioner "local-exec" {
    command = "ansible-playbook -i ${self.public_ip}, -u ubuntu playbook.yml"
  }
}

output "instance_ips" {
  description = "Public IP addresses of web servers"
  value       = aws_instance.web[*].public_ip
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}
```

### Ansible Commands

```bash
# Ad-hoc commands
ansible all -m ping
ansible web -m shell -a "uptime"
ansible db -m apt -a "name=postgresql state=present" --become
ansible all -m setup  # Gather facts
ansible all -m copy -a "src=/etc/hosts dest=/tmp/hosts"

# Playbook execution
ansible-playbook playbook.yml
ansible-playbook playbook.yml -i inventory/production
ansible-playbook playbook.yml --check  # Dry run
ansible-playbook playbook.yml --diff   # Show changes
ansible-playbook playbook.yml --tags "install,config"
ansible-playbook playbook.yml --skip-tags "deploy"
ansible-playbook playbook.yml --start-at-task="Install nginx"
ansible-playbook playbook.yml --limit web01
ansible-playbook playbook.yml -e "version=1.2.3"
ansible-playbook playbook.yml --become --ask-become-pass

# Inventory management
ansible-inventory --list
ansible-inventory --graph
ansible-inventory --host web01

# Vault operations (secrets)
ansible-vault create secrets.yml
ansible-vault edit secrets.yml
ansible-vault encrypt vars/database.yml
ansible-vault decrypt vars/database.yml
ansible-vault view secrets.yml
ansible-playbook playbook.yml --ask-vault-pass
ansible-playbook playbook.yml --vault-password-file ~/.vault_pass

# Galaxy (roles and collections)
ansible-galaxy install geerlingguy.nginx
ansible-galaxy install -r requirements.yml
ansible-galaxy collection install community.general
ansible-galaxy collection list

# Configuration and facts
ansible-config dump
ansible-config list
ansible-doc -l  # List all modules
ansible-doc apt  # Module documentation
```

### Ansible Playbook Examples

```yaml
# playbook.yml - Web server setup
---
- name: Configure web servers
  hosts: web
  become: yes
  vars:
    app_version: "1.0.0"
    deploy_user: "deploy"
    app_port: 8080

  tasks:
    - name: Update apt cache
      apt:
        update_cache: yes
        cache_valid_time: 3600

    - name: Install required packages
      apt:
        name:
          - nginx
          - python3-pip
          - git
          - ufw
        state: present

    - name: Create deploy user
      user:
        name: "{{ deploy_user }}"
        shell: /bin/bash
        groups: www-data
        append: yes

    - name: Copy nginx configuration
      template:
        src: templates/nginx.conf.j2
        dest: /etc/nginx/sites-available/app
        owner: root
        group: root
        mode: '0644'
      notify:
        - restart nginx

    - name: Enable nginx site
      file:
        src: /etc/nginx/sites-available/app
        dest: /etc/nginx/sites-enabled/app
        state: link
      notify:
        - restart nginx

    - name: Configure firewall
      ufw:
        rule: allow
        port: "{{ item }}"
        proto: tcp
      loop:
        - 22
        - 80
        - 443

    - name: Enable firewall
      ufw:
        state: enabled
        policy: deny

    - name: Clone application repository
      git:
        repo: https://github.com/org/app.git
        dest: /opt/app
        version: "v{{ app_version }}"
      become_user: "{{ deploy_user }}"

    - name: Install application dependencies
      pip:
        requirements: /opt/app/requirements.txt
        virtualenv: /opt/app/venv
      become_user: "{{ deploy_user }}"

    - name: Copy systemd service file
      template:
        src: templates/app.service.j2
        dest: /etc/systemd/system/app.service
        owner: root
        group: root
        mode: '0644'
      notify:
        - reload systemd
        - restart app

  handlers:
    - name: restart nginx
      service:
        name: nginx
        state: restarted

    - name: reload systemd
      systemd:
        daemon_reload: yes

    - name: restart app
      service:
        name: app
        state: restarted
        enabled: yes

# inventory/production.ini
[web]
web01 ansible_host=10.0.1.10
web02 ansible_host=10.0.1.11

[db]
db01 ansible_host=10.0.2.10

[all:vars]
ansible_user=ubuntu
ansible_ssh_private_key_file=~/.ssh/id_rsa
```

### Integration Script (Terraform + Ansible)

```bash
#!/bin/bash
# deploy.sh - Complete infrastructure deployment

set -e

echo "=== Terraform Provisioning ==="
cd terraform/

# Select workspace
terraform workspace select production || terraform workspace new production

# Plan infrastructure
terraform plan -out=tfplan

# Apply with approval
read -p "Apply this plan? (yes/no): " APPLY
if [ "$APPLY" = "yes" ]; then
  terraform apply tfplan
else
  echo "Deployment cancelled"
  exit 1
fi

# Extract outputs
terraform output -json > outputs.json
INSTANCE_IPS=$(terraform output -json instance_ips | jq -r '.[]')

echo "=== Generating Ansible Inventory ==="
cd ../ansible/

# Generate dynamic inventory
cat > inventory/hosts.ini <<EOF
[web]
EOF

for IP in $INSTANCE_IPS; do
  echo "$IP" >> inventory/hosts.ini
done

cat >> inventory/hosts.ini <<EOF

[all:vars]
ansible_user=ubuntu
ansible_ssh_private_key_file=~/.ssh/id_rsa
EOF

# Wait for SSH to be available
echo "=== Waiting for SSH ==="
for IP in $INSTANCE_IPS; do
  while ! nc -z $IP 22; do
    echo "Waiting for $IP:22..."
    sleep 5
  done
done

echo "=== Running Ansible Playbook ==="
ansible-playbook -i inventory/hosts.ini playbook.yml --diff

echo "=== Deployment Complete ==="
echo "Web servers available at:"
for IP in $INSTANCE_IPS; do
  echo "  http://$IP"
done
```

## MCP Server Integration

### Configuration (.codebuddy/mcp.json)

```json
{
  "mcpServers": {
    "sysoperator": {
      "command": "npx",
      "args": ["-y", "@sysoperator/mcp-server"],
      "env": {
        "TF_WORKSPACE": "production",
        "ANSIBLE_CONFIG": "/home/user/.ansible.cfg"
      }
    }
  }
}
```

### Available MCP Tools

**terraform_init**
- Initializes Terraform working directory
- Parameters: `directory` (string), `upgrade` (boolean)
- Returns: Initialization status, provider versions

**terraform_plan**
- Creates execution plan
- Parameters: `directory` (string), `variables` (object), `target` (optional)
- Returns: Plan summary, resource changes

**terraform_apply**
- Applies Terraform configuration
- Parameters: `directory` (string), `auto_approve` (boolean), `variables` (object)
- Returns: Applied resources, outputs

**terraform_destroy**
- Destroys managed infrastructure
- Parameters: `directory` (string), `auto_approve` (boolean), `target` (optional)
- Returns: Destruction summary

**terraform_output**
- Retrieves output values
- Parameters: `directory` (string), `output_name` (optional)
- Returns: Output values (all or specific)

**terraform_state_list**
- Lists resources in state
- Parameters: `directory` (string)
- Returns: List of managed resources

**ansible_playbook_run**
- Executes Ansible playbook
- Parameters: `playbook_path` (string), `inventory` (string), `extra_vars` (object), `tags` (array)
- Returns: Playbook execution results

**ansible_adhoc_command**
- Runs ad-hoc Ansible command
- Parameters: `hosts` (string), `module` (string), `args` (object), `become` (boolean)
- Returns: Command output per host

**ansible_inventory_list**
- Lists inventory hosts and groups
- Parameters: `inventory_path` (string)
- Returns: Host groups and variables

**ansible_vault_encrypt**
- Encrypts file with Ansible Vault
- Parameters: `file_path` (string), `vault_password` (string)
- Returns: Encryption confirmation

**ansible_galaxy_install**
- Installs Ansible roles/collections
- Parameters: `name` (string), `type` (enum: role/collection)
- Returns: Installation status

## Common Workflows

### 1. Provision Multi-Tier Application Infrastructure

```bash
# Directory structure
mkdir -p infra/{terraform,ansible}
cd infra/terraform

# Create Terraform configuration
cat > main.tf <<'EOF'
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# VPC and networking
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = { Name = "app-vpc" }
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "public-${count.index + 1}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "app-igw" }
}

# Security groups
resource "aws_security_group" "web" {
  name        = "web-sg"
  vpc_id      = aws_vpc.main.id
  description = "Web tier security group"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# EC2 instances
resource "aws_instance" "web" {
  count                  = 2
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.small"
  subnet_id              = aws_subnet.public[count.index].id
  vpc_security_group_ids = [aws_security_group.web.id]
  key_name               = "deployer-key"

  tags = {
    Name = "web-${count.index + 1}"
    Role = "web"
  }
}

# RDS database
resource "aws_db_instance" "main" {
  identifier           = "app-db"
  engine               = "postgres"
  engine_version       = "14.7"
  instance_class       = "db.t3.micro"
  allocated_storage    = 20
  username             = "dbadmin"
  password             = var.db_password
  skip_final_snapshot  = true

  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
}

output "web_ips" {
  value = aws_instance.web[*].public_ip
}

output "db_endpoint" {
  value = aws_db_instance.main.endpoint
}
EOF

# Initialize and apply
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# Generate Ansible inventory
terraform output -json web_ips | jq -r '.[]' | \
  awk '{print $1 " ansible_host=" $1}' > ../ansible/inventory/hosts

# Configure with Ansible
cd ../ansible
ansible-playbook -i inventory/hosts site.yml
```

### 2. Blue-Green Deployment with Zero Downtime

```bash
# Terraform configuration for blue-green
cat > blue-green.tf <<'EOF'
variable "active_environment" {
  default = "blue"
}

resource "aws_lb" "main" {
  name               = "app-lb"
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "blue" {
  name     = "blue-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 10
  }
}

resource "aws_lb_target_group" "green" {
  name     = "green-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 10
  }
}

resource "aws_lb_listener" "main" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = var.active_environment == "blue" ? \
                       aws_lb_target_group.blue.arn : \
                       aws_lb_target_group.green.arn
  }
}

resource "aws_autoscaling_group" "blue" {
  name                = "blue-asg"
  max_size            = 4
  min_size            = 2
  desired_capacity    = 2
  target_group_arns   = [aws_lb_target_group.blue.arn]
  vpc_zone_identifier = aws_subnet.public[*].id

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  tag {
    key                 = "Environment"
    value               = "blue"
    propagate_at_launch = true
  }
}

resource "aws_autoscaling_group" "green" {
  name                = "green-asg"
  max_size            = 4
  min_size            = 0
  desired_capacity    = 0
  target_group_arns   = [aws_lb_target_group.green.arn]
  vpc_zone_identifier = aws_subnet.public[*].id

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  tag {
    key                 = "Environment"
    value               = "green"
    propagate_at_launch = true
  }
}
EOF

# Deploy new version to green
terraform apply -var="active_environment=blue"

# Provision green instances
aws autoscaling set-desired-capacity --auto-scaling-group-name green-asg --desired-capacity 2

# Wait for health checks
sleep 60

# Test green environment
curl http://green-lb-endpoint/health

# Switch traffic to green
terraform apply -var="active_environment=green"

# Scale down blue
aws autoscaling set-desired-capacity --auto-scaling-group-name blue-asg --desired-capacity 0
```

### 3. Immutable Infrastructure with Packer and Ansible

```bash
# Create Packer template
cat > packer.json <<'EOF'
{
  "builders": [{
    "type": "amazon-ebs",
    "region": "us-east-1",
    "source_ami_filter": {
      "filters": {
        "name": "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
      },
      "owners": ["099720109477"],
      "most_recent": true
    },
    "instance_type": "t3.small",
    "ssh_username": "ubuntu",
    "ami_name": "app-{{timestamp}}"
  }],
  "provisioners": [
    {
      "type": "ansible",
      "playbook_file": "./ansible/provision.yml",
      "extra_arguments": [
        "--extra-vars",
        "app_version={{user `app_version`}}"
      ]
    }
  ]
}
EOF

# Create Ansible provisioning playbook
cat > ansible/provision.yml <<'EOF'
---
- hosts: all
  become: yes
  vars:
    app_version: "1.0.0"

  tasks:
    - name: Install dependencies
      apt:
        name:
          - nginx
          - python3
          - git
        update_cache: yes

    - name: Clone application
      git:
        repo: https://github.com/org/app.git
        dest: /opt/app
        version: "v{{ app_version }}"

    - name: Configure service
      template:
        src: app.service.j2
        dest: /etc/systemd/system/app.service

    - name: Enable service
      systemd:
        name: app
        enabled: yes
EOF

# Build AMI
packer build -var "app_version=1.5.0" packer.json

# Update Terraform to use new AMI
AMI_ID=$(aws ec2 describe-images --owners self --filters "Name=name,Values=app-*" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)

# Deploy with new AMI
cat > terraform/ami.tf <<EOF
data "aws_ami" "app" {
  most_recent = true
  owners      = ["self"]

  filter {
    name   = "name"
    values = ["app-*"]
  }
}

resource "aws_launch_template" "app" {
  image_id      = data.aws_ami.app.id
  instance_type = "t3.small"
}
EOF

terraform apply
```

### 4. Secrets Management with Vault Integration

```bash
# Ansible playbook with Vault
cat > deploy.yml <<'EOF'
---
- hosts: all
  become: yes
  vars_files:
    - vault_secrets.yml

  tasks:
    - name: Create database config
      template:
        src: database.yml.j2
        dest: /opt/app/config/database.yml
        mode: '0600'
      no_log: true

    - name: Set environment variables
      lineinfile:
        path: /etc/environment
        line: "{{ item.key }}={{ item.value }}"
        create: yes
      loop:
        - { key: "DB_PASSWORD", value: "{{ db_password }}" }
        - { key: "API_KEY", value: "{{ api_key }}" }
      no_log: true
EOF

# Encrypt secrets
cat > vault_secrets.yml <<'EOF'
db_password: supersecret123
api_key: sk-1234567890abcdef
aws_secret_key: AKIA1234567890ABCDEF
EOF

ansible-vault encrypt vault_secrets.yml

# Run with vault password
ansible-playbook deploy.yml --ask-vault-pass

# Or use password file
echo "my-vault-password" > .vault_pass
chmod 600 .vault_pass
ansible-playbook deploy.yml --vault-password-file .vault_pass
```

### 5. Complete Infrastructure Testing and Validation

```bash
# Create test playbook
cat > test.yml <<'EOF'
---
- name: Test infrastructure
  hosts: web
  gather_facts: yes

  tasks:
    - name: Check nginx is running
      service:
        name: nginx
        state: started
      check_mode: yes
      register: nginx_status
      failed_when: false

    - name: Verify application port is listening
      wait_for:
        port: 8080
        timeout: 5
        state: started

    - name: Check application health endpoint
      uri:
        url: http://localhost:8080/health
        return_content: yes
      register: health_check
      failed_when: health_check.status != 200

    - name: Verify disk space
      assert:
        that:
          - ansible_mounts | selectattr('mount', 'equalto', '/') | map(attribute='size_available') | first > 1000000000
        fail_msg: "Insufficient disk space"

    - name: Check memory usage
      assert:
        that:
          - ansible_memory_mb.real.free > 500
        fail_msg: "Low memory available"

    - name: Test database connectivity
      postgresql_ping:
        db: myapp
        login_host: "{{ db_host }}"
        login_user: "{{ db_user }}"
        login_password: "{{ db_password }}"
      delegate_to: localhost
EOF

# Run tests
ansible-playbook -i inventory/production test.yml

# Terraform validation
cd terraform/
terraform validate
terraform fmt -check
tflint  # Install with: brew install tflint

# Run kitchen tests (if using test-kitchen)
kitchen test

# Integration tests script
cat > validate.sh <<'EOF'
#!/bin/bash
set -e

echo "=== Terraform Validation ==="
cd terraform/
terraform validate
terraform plan -detailed-exitcode

echo "=== Ansible Syntax Check ==="
cd ../ansible/
ansible-playbook --syntax-check site.yml

echo "=== Ansible Lint ==="
ansible-lint site.yml

echo "=== Infrastructure Tests ==="
ansible-playbook -i inventory/production test.yml

echo "=== All validations passed ==="
EOF

chmod +x validate.sh
./validate.sh
```

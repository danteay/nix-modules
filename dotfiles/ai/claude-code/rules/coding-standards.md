# Coding Standards Rules

## General Principles

- Write clean, maintainable, and well-documented code
- Follow the principle of least surprise
- Prefer composition over inheritance
- Keep functions small and focused on a single responsibility
- Use meaningful variable and function names

## Code Quality

- Always write tests for new features and bug fixes
- Maintain test coverage above 80%
- Run linters and formatters before committing
- Address all compiler warnings
- Avoid premature optimization

## Documentation

- Document public APIs and exported functions
- Keep README files up to date (if README don't exists, create one)
- Include usage examples in documentation
- Document architectural decisions
- Add inline comments for complex logic only

## Version Control

- Write clear, descriptive commit messages
- Keep commits atomic and focused
- Reference issue numbers in commit messages
- Never commit sensitive data (secrets, keys, tokens)
- Review your own changes before requesting review
- To create Pull request use PR template from .github folder for description (enforce format) and generate pr using gh cli
- for PR title use next format: `<sember-prefix>: <pr-title> [<issue-number>]`. If issue number is not provided, omit it.

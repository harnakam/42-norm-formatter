/* ************************************************************************** */
/*                                                                            */
/*                                                       :::      ::::::::    */
/*   hoist_declarations.c                              :+:      :+:    :+:    */
/*                                                   +:+ +:+         +:+      */
/*   By: username <username@student.42tokyo.jp>    #+#  +:+       +#+         */
/*                                               +#+#+#+#+#+   +#+            */
/*   Created: 2026/03/13 07:52:01 by username         #+#    #+#              */
/*   Updated: 2026/03/13 07:52:01 by username        ###   ########.fr        */
/*                                                                            */
/* ************************************************************************** */

int	main(void)
{
	int	result;
	int	tmp;

	result = 1;
	if (result)
	{
		tmp = result;
		result = tmp;
	}
	return (result);
}

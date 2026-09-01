#include "ft_printf.h"

static int	ft_print_unknown(char c)
{
	int	percent_len;
	int	char_len;

	percent_len = ft_print_char('%');
	if (percent_len < 0)
		return (-1);
	char_len = ft_print_char(c);
	if (char_len < 0)
		return (-1);
	return (percent_len + char_len);
}

int	ft_printf(const char *format, ...)
{
	int	total;
	int	printed;

	va_list args;
	if (!format)
		return (-1);
	total = 0;
	va_start(args, format);
	while (*format)
	{
		if (*format == '%')
		{
			format++;
			if (!*format)
				break ;
			printed = ft_print_unknown(*format);
		}
		else
			printed = ft_print_char(*format);
		if (printed < 0)
			return (va_end(args), -1);
		total += printed;
		format++;
	}
	va_end(args);
	return (total);
}
